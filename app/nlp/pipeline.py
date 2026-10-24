import json
import logging
import math
import os
import re
import sqlite3
import threading
import time

import google.generativeai as genai
import pandas as pd
from dotenv import load_dotenv
from fastapi import HTTPException

try:
    import chromadb
    from chromadb.utils import embedding_functions
except Exception:
    chromadb = None
    embedding_functions = None

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logger = logging.getLogger(__name__)
_API_KEY_ROTATION_LOCK = threading.Lock()
_API_KEY_ROTATION_INDEX = 0


class _FallbackCollection:
    def __init__(self, docs: list[str], ids: list[str]):
        self.docs = docs
        self.ids = ids

    def query(self, query_texts: list[str], n_results: int = 3):
        query = query_texts[0] if query_texts else ""
        q_tokens = set(re.sub(r"[^a-z0-9 ]", " ", query.lower()).split())
        scored = []
        for doc_id, doc in zip(self.ids, self.docs):
            d_tokens = set(re.sub(r"[^a-z0-9 ]", " ", doc.lower()).split())
            scored.append((len(q_tokens & d_tokens), doc_id, doc))
        scored.sort(key=lambda row: row[0], reverse=True)
        top = scored[:n_results]
        return {"ids": [[row[1] for row in top]], "documents": [[row[2] for row in top]]}


class Config:
    API_KEYS_RAW = os.getenv("GEMINI_API_KEYS", "")
    API_KEY = os.getenv("GEMINI_API_KEY", "")
    DB_PATH = os.path.join(BASE_DIR, "frammer_analytics.db")
    FEW_SHOT_PATH = os.path.join(BASE_DIR, "few_shot_examples.json")
    MAX_RETRIES = 2
    TOP_K = 3
    RAG_TOP_TABLES = 5
    DATA_DIR = os.path.join(BASE_DIR, "data")
    JSON_CONFIG = {"response_mime_type": "application/json"}

    TABLE_DESCRIPTIONS = {
        "dim_channel_client": "Channels and parent media companies. Clients and Brands.",
        "dim_date": "Calendar dimension. Month 1-12, Quarter 1-4. Time, dates, years, weeks.",
        "dim_input_type": "Type of raw video. Values: interview, news bulletin, special reports, speech, debate, podcast.",
        "dim_input_video": "Input video metadata: headline, source name, source URL.",
        "dim_language": "Language lookup. Values: en, hi, mr, mix, es, ar. Hindi, English.",
        "dim_output_type": "Output clip format. Values: Full Package, Key moments, Chapters, Summary.",
        "dim_output_video": "Output video headline only. Published_URL lives in fact_publish.",
        "dim_platform": "Platform lookup. YouTube, Facebook, Instagram, LinkedIn, Reels, Shorts, X, Threads.",
        "dim_user_team": "Users and their teams. Uploaders, staff.",
        "fact_data_quality": "Error log. failures, missing audio, corrupted files.",
        "fact_input_video_operations": "PIPELINE STEP 1 - Every upload event. Uploads, raw files, initial ingestion. Durations are HH:MM:SS.",
        "fact_output_video_operations": "PIPELINE STEP 2 - Every processed clip. Edits, cut video, final creations. Durations are HH:MM:SS.",
        "fact_publish_information": "PIPELINE STEP 3 - Every publish event. Social media posting, going live, billing. Durations are HH:MM:SS.",
    }
    KPI_DEFINITIONS = {
        "Chapters": "Measures segmented content creation.",
        "Key Moments": "Tracks highlight clip generation.",
        "Summary": "Measures short-form summarized outputs.",
        "My Key Moments": "Tracks user-customized highlights.",
        "Translation Rate": "Shows percentage of content translated to other languages.",
        "Translation Uplift": "Measures value gained from translation.",
        "Videos Uploaded": "Shows total content entering the AI pipeline.",
        "Videos Processed": "Measures how much content AI successfully processes.",
        "Upload to Process Rate": "Indicates efficiency of the processing stage.",
        "Process to Publish Rate": "Shows how much processed content gets published.",
        "End-to-End Rate": "Measures overall pipeline effectiveness.",
        "Publish Rate": "Indicates final publishing success.",
        "Health Score": "Summarizes overall system performance.",
        "Recoverable Hours": "Shows lost processing time that could be recovered.",
        "Billable Upside": "Indicates potential revenue from unused output.",
        "Stalled Outputs": "Detects content stuck in the pipeline.",
        "Average Publish Latency": "Measures delay between processing and publishing.",
        "Clip Multiplication": "Shows how many clips AI generates per video.",
        "Duration Compression": "Measures reduction from long videos to short clips.",
        "Platforms Reached": "Indicates distribution across publishing platforms.",
        "Data Completeness": "Shows reliability and quality of dataset.",
        "Publishing Dropout": "Detects content lost before publishing.",
        "Content Reuse Ratio": "Measures how well content is repurposed.",
        "Full Repurposing Rate": "Shows inputs converted to all output types.",
        "Weekend Publish Rate": "Tracks publishing behavior on weekends.",
        "Upload Duration / Long Video Uploads": "Indicates demand for AI video processing.",
        "Processing Time": "Measures speed of AI clip processing.",
        "Active Clients": "Indicates number of clients using the platform.",
        "Active Channels": "Shows number of active publishing channels.",
        "Total Videos": "Shows total content volume in the system.",
        "Total Duration": "Measures total hours of content processed.",
        "Videos Published": "Indicates total successful outputs.",
        "Drop-off %": "Shows percentage of content lost in pipeline.",
        "Avg Upload to Process Time": "Measures delay from upload to AI processing.",
        "Avg Process to Publish Time": "Measures delay from processing to publishing.",
        "Full Package": "Tracks full-length content output volume.",
    }
    FK_MAP = {
        "fact_input_video_operations": {
            "Input_Video_ID": ("dim_input_video", "Input_Video_ID"),
            "Channel_ID": ("dim_channel_client", "Channel_ID"),
            "User_ID": ("dim_user_team", "User_ID"),
            "Input_Type_ID": ("dim_input_type", "Input_Type_ID"),
            "Output_Type_ID": ("dim_output_type", "Output_Type_ID"),
            "Language_ID": ("dim_language", "Language_ID"),
            "Upload_Date_ID": ("dim_date", "Date_ID"),
        },
        "fact_output_video_operations": {
            "Output_Video_ID": ("dim_output_video", "Output_Video_ID"),
            "Output_Type_ID": ("dim_output_type", "Output_Type_ID"),
            "Language_ID": ("dim_language", "Language_ID"),
            "Created_Date_ID": ("dim_date", "Date_ID"),
            "Fact_Input_ID": ("fact_input_video_operations", "Fact_Input_ID"),
        },
        "fact_publish_information": {
            "Platform_ID": ("dim_platform", "Platform_ID"),
            "Published_Date_ID": ("dim_date", "Date_ID"),
            "Fact_Output_ID": ("fact_output_video_operations", "Fact_Output_ID"),
        },
        "fact_data_quality": {
            "Video_ID": ("dim_input_video", "Input_Video_ID"),
            "Log_Date_ID": ("dim_date", "Date_ID"),
        },
    }
    PK_MAP = {
        "dim_channel_client": "Channel_ID",
        "dim_date": "Date_ID",
        "dim_input_type": "Input_Type_ID",
        "dim_input_video": "Input_Video_ID",
        "dim_language": "Language_ID",
        "dim_output_type": "Output_Type_ID",
        "dim_output_video": "Output_Video_ID",
        "dim_platform": "Platform_ID",
        "dim_user_team": "User_ID",
        "fact_input_video_operations": "Fact_Input_ID",
        "fact_output_video_operations": "Fact_Output_ID",
        "fact_publish_information": "Fact_Publish_ID",
        "fact_data_quality": "DQ_Log_ID",
    }


class GeminiServiceError(Exception):
    def __init__(self, public_message: str):
        super().__init__(public_message)
        self.public_message = public_message


def _parse_api_keys() -> list[str]:
    values: list[str] = []
    for raw_value in (Config.API_KEYS_RAW, Config.API_KEY):
        if not raw_value:
            continue
        values.extend(part.strip() for part in re.split(r"[\r\n,]+", raw_value) if part.strip())

    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def _next_key_order(api_keys: list[str]) -> list[str]:
    if len(api_keys) <= 1:
        return api_keys

    global _API_KEY_ROTATION_INDEX
    with _API_KEY_ROTATION_LOCK:
        start_index = _API_KEY_ROTATION_INDEX % len(api_keys)
        _API_KEY_ROTATION_INDEX += 1
    return api_keys[start_index:] + api_keys[:start_index]


def _is_rate_limit_error(exc: Exception) -> bool:
    message = str(exc).lower()
    rate_limit_markers = (
        "429",
        "rate limit",
        "too many requests",
        "resource_exhausted",
        "quota",
        "retry_delay",
    )
    return any(marker in message for marker in rate_limit_markers)


def _sanitize_model_error(exc: Exception) -> str:
    if _is_rate_limit_error(exc):
        return "The AI service is temporarily busy. Please try again in a moment."
    return "The AI service is temporarily unavailable. Please try again shortly."


def _generate_content(prompt: str, *, json_mode: bool = False):
    api_keys = _parse_api_keys()
    if not api_keys:
        raise HTTPException(
            status_code=503,
            detail="Gemini API keys are not configured. Set GEMINI_API_KEYS or GEMINI_API_KEY.",
        )

    last_error: Exception | None = None
    key_order = _next_key_order(api_keys)
    generation_config = Config.JSON_CONFIG if json_mode else None

    for index, api_key in enumerate(key_order, start=1):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash", generation_config=generation_config)
            return model.generate_content(prompt)
        except HTTPException:
            raise
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Gemini request failed for key %s/%s: %s",
                index,
                len(key_order),
                type(exc).__name__,
            )

    if last_error is None:
        raise GeminiServiceError("The AI service is temporarily unavailable. Please try again shortly.")
    raise GeminiServiceError(_sanitize_model_error(last_error))


class DatabaseManager:
    @staticmethod
    def initialize_database():
        if os.path.exists(Config.DB_PATH):
            try:
                check_conn = sqlite3.connect(Config.DB_PATH)
                table_count = check_conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
                check_conn.close()
                if table_count > 0:
                    return
            except Exception:
                pass
        conn = sqlite3.connect(Config.DB_PATH)
        csv_files = [
            "dim_channel_client.csv", "dim_date.csv", "dim_input_type.csv", "dim_input_video.csv",
            "dim_language.csv", "dim_output_type.csv", "dim_output_video.csv", "dim_platform.csv",
            "dim_user_team.csv", "fact_input_video_operations.csv", "fact_output_video_operations.csv",
            "fact_publish_information.csv", "fact_data_quality.csv",
        ]
        for file in csv_files:
            path = os.path.join(Config.DATA_DIR, file)
            if os.path.exists(path):
                table_name = file.replace(".csv", "")
                df = pd.read_csv(path)
                if table_name == "fact_input_video_operations":
                    df["User_ID"] = df["User_ID"].astype(str)
                    df["Channel_ID"] = df["Channel_ID"].astype(str)
                df.to_sql(table_name, conn, if_exists="replace", index=False)
        conn.close()

    @staticmethod
    def build_schema_with_pragma(conn, selected_tables=None) -> str:
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        all_tables = [row[0] for row in cursor.fetchall()]
        tables = [t for t in selected_tables if t in all_tables] if selected_tables else all_tables
        lines = []
        for table in tables:
            lines.append(f"-- {Config.TABLE_DESCRIPTIONS.get(table, 'Core Fact Table.')}")
            cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
            pk_col = Config.PK_MAP.get(table)
            table_fks = Config.FK_MAP.get(table, {})
            actual_col_names = {c[1] for c in cols}
            col_defs = []
            for c in cols:
                suffix = " PRIMARY KEY" if c[1] == pk_col else ""
                col_defs.append(f"    {c[1]} {(c[2] or 'VARCHAR')}{suffix}")
            fk_defs = []
            for fk_col, (ref_table, ref_col) in table_fks.items():
                if fk_col in actual_col_names and ref_table in tables:
                    fk_defs.append(f"    FOREIGN KEY ({fk_col}) REFERENCES {ref_table}({ref_col})")
            lines.append(f"CREATE TABLE {table} (")
            lines.append(",\n".join(col_defs + fk_defs))
            lines.append(");\n")
        return "\n".join(lines)


class KnowledgeBase:
    _schema_collection = None

    @staticmethod
    def setup_chroma_db(saved_kpis: list[tuple[str, str]] | None = None):
        if KnowledgeBase._schema_collection is None:
            conn = sqlite3.connect(Config.DB_PATH)
            schema_ids, schema_docs = [], []
            for table, desc in Config.TABLE_DESCRIPTIONS.items():
                try:
                    cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
                    doc = f"{table}: {desc}\nColumns: {', '.join([c[1] for c in cols])}"
                except Exception:
                    doc = f"{table}: {desc}"
                schema_ids.append(table)
                schema_docs.append(doc)
            conn.close()

            if chromadb is not None and embedding_functions is not None:
                client = chromadb.PersistentClient(path=os.path.join(BASE_DIR, "chroma_db_cache"))
                ef = embedding_functions.DefaultEmbeddingFunction()
                schema_collection = client.get_or_create_collection("schema_rag", embedding_function=ef)
                schema_collection.upsert(documents=schema_docs, ids=schema_ids)
            else:
                schema_collection = _FallbackCollection(schema_docs, schema_ids)

            KnowledgeBase._schema_collection = schema_collection

        builtin_items = list(Config.KPI_DEFINITIONS.items())
        saved_items = saved_kpis or []
        
        merged_items: list[tuple[str, str]] = []
        seen_names: set[str] = set()

        for name, definition in builtin_items + saved_items:
            key = name.strip().lower()
            if not key or key in seen_names:
                continue
            seen_names.add(key)
            merged_items.append((name, definition))

        kpi_ids = [name for name, _ in merged_items]
        kpi_docs = [f"KPI Name: {name}\nDefinition: {definition}" for name, definition in merged_items]
        
        if chromadb is not None and embedding_functions is not None:
            client = chromadb.PersistentClient(path=os.path.join(BASE_DIR, "chroma_db_cache"))
            ef = embedding_functions.DefaultEmbeddingFunction()
            kpi_collection = client.get_or_create_collection("kpi_rag", embedding_function=ef)
            if kpi_ids:
                kpi_collection.upsert(documents=kpi_docs, ids=kpi_ids)
        else:
            kpi_collection = _FallbackCollection(kpi_docs, kpi_ids)

        return KnowledgeBase._schema_collection, kpi_collection

    @staticmethod
    def retrieve_relevant_tables(question: str, collection, k=Config.RAG_TOP_TABLES) -> list:
        results = collection.query(query_texts=[question], n_results=k)
        return results["ids"][0] if results["ids"] else []

    @staticmethod
    def expand_schema_graph(seed_tables: list) -> list:
        expanded = set(seed_tables)
        added_new = True
        while added_new:
            added_new = False
            for table in list(expanded):
                for fact_table, references in Config.FK_MAP.items():
                    for _, (ref_table, _) in references.items():
                        if ref_table in expanded and fact_table not in expanded:
                            expanded.add(fact_table)
                            added_new = True
                        if fact_table in expanded and ref_table not in expanded:
                            expanded.add(ref_table)
                            added_new = True
        return list(expanded)


class BM25Retriever:
    @staticmethod
    def load_examples():
        if not os.path.exists(Config.FEW_SHOT_PATH):
            return []
        with open(Config.FEW_SHOT_PATH, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _tokenize(text: str) -> list:
        return re.sub(r"[^a-z0-9 ]", "", text.lower()).split()

    @staticmethod
    def _build_index(corpus: list, k1: float = 1.5, b: float = 0.75) -> dict:
        tokenized = [BM25Retriever._tokenize(doc) for doc in corpus]
        n_docs = len(tokenized)
        avgdl = sum(len(d) for d in tokenized) / max(n_docs, 1)
        df = {}
        for doc in tokenized:
            for word in set(doc):
                df[word] = df.get(word, 0) + 1
        idf = {word: math.log((n_docs - freq + 0.5) / (freq + 0.5) + 1) for word, freq in df.items()}
        return {"tokenized": tokenized, "idf": idf, "avgdl": avgdl, "k1": k1, "b": b}

    @staticmethod
    def _score(query_tokens: list, index: dict) -> list:
        tokenized, idf, avgdl, k1, b = index["tokenized"], index["idf"], index["avgdl"], index["k1"], index["b"]
        scores = []
        for doc_tokens in tokenized:
            dl, freq = len(doc_tokens), {}
            for word in doc_tokens:
                freq[word] = freq.get(word, 0) + 1
            scores.append(sum((idf[w] * freq.get(w, 0) * (k1 + 1)) / (freq.get(w, 0) + k1 * (1 - b + b * dl / max(avgdl, 1))) for w in query_tokens if w in idf))
        return scores

    @staticmethod
    def retrieve(query: str, examples: list, k: int = Config.TOP_K) -> list:
        if not examples:
            return []
        if len(examples) <= k:
            return examples
        index = BM25Retriever._build_index([ex["question"] for ex in examples])
        scores = BM25Retriever._score(BM25Retriever._tokenize(query), index)
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
        return [examples[i] for i in top_indices]


# class PromptManager:
#     ROUTER_PROMPT = """
# You are an Intent Router. Analyze the user's question and route it to either:
# 1. "SQL" - The user is asking for data, numbers, counts, complex queries, or metrics from the database (e.g. "How many...", "Which channel...").
# 2. "KPI" - The user is asking for a definition, meaning, or explanation of a specific KPI term (e.g. "What is Full Package?", "Explain Clip Multiplication", "What does Translation Rate mean?").

# Return strictly JSON:
# {
#   "route": "SQL" | "KPI",
#   "reason": "..."
# }
# """
#     PLANNER_PROMPT = """
# You are a query planning expert for Frammer AI. Analyse the question and produce an execution plan.

# COMPLEXITY RULES:
#   SIMPLE — touches 1 fact table + its dimensions.
#   MULTI_STEP — crosses 2+ fact tables OR requires CTE.

# Provide Output strictly matching this JSON schema:
# {
#   "complexity": "SIMPLE" | "MULTI_STEP",
#   "plan": [{"step": 1, "description": "...", "tables": ["..."]}],
#   "duration_math_needed": boolean,
#   "duration_operation": "SUM" | "AVG" | "MAX" | null
# } 
# """
#     STATIC_INSTRUCTIONS = """
# You are an expert data analyst. Convert the question into a valid SQLite query.
# Use the PRIMARY KEY and FOREIGN KEY constraints in the SCHEMA to determine correct JOINs.

# RULES:
# - Use LEFT JOIN for funnel analysis.
# - Use COUNT(DISTINCT ...) when chaining across fact tables.
# - Is_Billable is integer 1 or 0. Use WHERE Is_Billable = 1.
# - When filtering by name, JOIN the dimension table and filter on the name column.
# - ALWAYS use COLLATE NOCASE for string comparisons: WHERE col = 'value' COLLATE NOCASE

# DURATION MATH (CRITICAL SAFETY GUARD):
# Never run SUBSTR on a raw column. Always guard against malformed/null data:
#   SUM(CASE 
#         WHEN col IS NOT NULL AND LENGTH(col)=8 THEN 
#           (CAST(SUBSTR(col, 1, 2) AS INTEGER) * 3600 + CAST(SUBSTR(col, 4, 2) AS INTEGER) * 60 + CAST(SUBSTR(col, 7, 2) AS INTEGER))
#         ELSE 0 
#       END)

# Provide Output strictly matching this JSON schema:
# {
#   "sql": "SELECT ...",
#   "filters_applied": ["..."],
#   "reason": "..."
# }
# """
#     VERIFIER_INSTRUCTIONS = """
# Check if the generated SQL correctly answers the user's question.

# Failure types to check:
# A. SEMANTIC MISMATCH
# B. WRONG TABLE
# C. MISSING JOIN
# D. WRONG FILTER VALUE
# E. WRONG AGGREGATION
# F. WRONG JOIN TYPE
# G. INCOMPLETE ANSWER
# H. UNGUARDED DURATION MATH - Ensure SUBSTR uses the CASE WHEN length=8 guard.
# I. NON-EXISTENT COLUMN - Cross-check against SCHEMA provided.

# Provide Output strictly matching this JSON schema:
# {
#   "verdict": "PASS" | "FAIL",
#   "reason": "...",
#   "fix_hint": "..." 
# }    
# """

class PromptManager:
    ROUTER_PROMPT = """
You are an Intent Router. Analyze the user's question and route it to either:
1. "SQL" - The user is asking for data, numbers, counts, complex queries, or metrics from the database (e.g. "How many...", "Which channel...").
2. "KPI" - The user is asking for a definition, meaning, or explanation of a specific KPI term (e.g. "What is Full Package?", "Explain Clip Multiplication", "What does Translation Rate mean?").

Return strictly JSON:
{
  "route": "SQL" | "KPI",
  "reason": "..."
}
"""
    PLANNER_PROMPT = """
You are a query planning expert for Frammer AI. Analyse the question and produce an execution plan.

COMPLEXITY RULES:
  SIMPLE — touches 1 fact table + its dimensions.
  MULTI_STEP — crosses 2+ fact tables OR requires CTE.

Provide Output strictly matching this JSON schema:
{
  "complexity": "SIMPLE" | "MULTI_STEP",
  "plan": [{"step": 1, "description": "...", "tables": ["..."]}],
  "duration_math_needed": boolean,
  "duration_operation": "SUM" | "AVG" | "MAX" | null
}
"""
    STATIC_INSTRUCTIONS = """
You are an expert data analyst. Convert the question into a valid SQLite query.
Use the PRIMARY KEY and FOREIGN KEY constraints in the SCHEMA to determine correct JOINs.

RULES:
- Use LEFT JOIN for funnel analysis.
- Use COUNT(DISTINCT ...) when chaining across fact tables.
- Is_Billable is integer 1 or 0. Use WHERE Is_Billable = 1.
- When filtering by name, JOIN the dimension table and filter on the name column.
- ALWAYS use COLLATE NOCASE for string comparisons: WHERE col = 'value' COLLATE NOCASE
- CRITICAL: Write the most optimal SQL code possible! Use the fewest lines and make it as concise, elegant, and efficient as possible.

DURATION MATH (CRITICAL SAFETY GUARD):
Never run SUBSTR on a raw column. Always guard against malformed/null data:
  SUM(CASE 
        WHEN col IS NOT NULL AND LENGTH(col)=8 THEN 
          (CAST(SUBSTR(col, 1, 2) AS INTEGER) * 3600 + CAST(SUBSTR(col, 4, 2) AS INTEGER) * 60 + CAST(SUBSTR(col, 7, 2) AS INTEGER))
        ELSE 0 
      END)

Provide Output strictly matching this JSON schema:
{
  "sql": "SELECT ...",
  "filters_applied": ["..."],
  "reason": "..."
}
"""
    VERIFIER_INSTRUCTIONS = """
Check if the generated SQL correctly answers the user's question.

Failure types to check:
A. SEMANTIC MISMATCH
B. WRONG TABLE
C. MISSING JOIN
D. WRONG FILTER VALUE
E. WRONG AGGREGATION
F. WRONG JOIN TYPE
G. INCOMPLETE ANSWER
H. UNGUARDED DURATION MATH - Ensure SUBSTR uses the CASE WHEN length=8 guard.
I. NON-EXISTENT COLUMN - Cross-check against SCHEMA provided.

Provide Output strictly matching this JSON schema:
{
  "verdict": "PASS" | "FAIL",
  "reason": "...",
  "fix_hint": "..." 
}
"""

class SemanticEngine:
    @staticmethod
    def route_query(question: str) -> dict:
        try:
            resp = _generate_content(f"{PromptManager.ROUTER_PROMPT}\n\nQUESTION: {question}", json_mode=True)
            return json.loads(resp.text)
        except Exception:
            return {"route": "SQL", "reason": "Fallback to SQL on error"}

    @staticmethod
    def kpi_rag_answer(question: str, kpi_collection) -> str:
        results = kpi_collection.query(query_texts=[question], n_results=3)
        docs = results["documents"][0] if results["documents"] else []
        prompt = f"Using ONLY the following KPI definitions, answer the user's question clearly and concisely.\n\nKPI DEFINITIONS:\n{chr(10).join(docs)}\n\nQUESTION: {question}"
        try:
            return _generate_content(prompt).text.strip()
        except HTTPException:
            return "KPI explanation is temporarily unavailable."
        except GeminiServiceError as exc:
            return exc.public_message

    @staticmethod
    def plan_query(question: str, schema: str) -> dict:
        try:
            resp = _generate_content(f"{PromptManager.PLANNER_PROMPT}\n\nSCHEMA:\n{schema}\n\nQUESTION: {question}", json_mode=True)
            return json.loads(resp.text)
        except Exception:
            return {"complexity": "SIMPLE", "plan": [{"step": 1, "description": question, "tables": []}], "duration_math_needed": False, "duration_operation": None}

    @staticmethod
    def generate_sql(question: str, schema: str, examples: list, fix_hint: str = "", plan: dict = None) -> tuple:
        ex_block = "EXAMPLES:\n" + "".join([f'Example {i}: "{ex["question"]}"\nSQL: {ex["sql"]}\n\n' for i, ex in enumerate(examples, 1)]) if examples else ""
        plan_block = "QUERY PLAN:\n" + "".join([f"  Step {s['step']}: {s['description']} ({', '.join(s.get('tables', []))})\n" for s in plan.get("plan", [])]) if plan and plan.get("plan") else ""
        q = question if not fix_hint else f"{question}\n\nPREVIOUS ATTEMPT FAILED. FIX REQUIRED: {fix_hint}"
        prompt = f"{PromptManager.STATIC_INSTRUCTIONS}\n\nSCHEMA:\n{schema}\n\n{plan_block}\n{ex_block}\nQUESTION: {q}"
        try:
            resp = _generate_content(prompt, json_mode=True)
            parsed = json.loads(resp.text)
            return parsed.get("sql"), parsed.get("filters_applied", []), parsed.get("reason")
        except HTTPException as exc:
            return None, [], exc.detail
        except GeminiServiceError as exc:
            return None, [], exc.public_message
        except Exception:
            return None, [], "The AI service returned an invalid response."

    @staticmethod
    def verify_sql(question: str, sql: str, schema: str) -> dict:
        try:
            resp = _generate_content(
                f"{PromptManager.VERIFIER_INSTRUCTIONS}\n\nSCHEMA:\n{schema}\n\nUSER QUESTION: {question}\n\nGENERATED SQL:\n{sql}",
                json_mode=True,
            )
            return json.loads(resp.text)
        except Exception:
            return {"verdict": "PASS", "reason": "Verifier unavailable; using generated SQL as-is.", "fix_hint": ""}

    @staticmethod
    def generate_nl_answer(question: str, df: pd.DataFrame) -> str:
        if df is None or df.empty:
            return "No data found."
        prompt = f'User asked: "{question}"\nData:\n{df.head(5).to_string(index=False)}\nWrite ONE concise sentence summarising the key insight. No SQL.'
        try:
            return _generate_content(prompt).text.strip()
        except HTTPException:
            return "Summary is temporarily unavailable."
        except GeminiServiceError as exc:
            return exc.public_message


class PipelineOrchestrator:
    @staticmethod
    def sanity_check(question: str, df: pd.DataFrame) -> dict:
        if df is None or df.empty:
            return {"passed": False, "warning": "Query returned 0 rows. Check WHERE clauses for over-filtering."}
        id_prefixes = ("CHANNEL_", "USER_", "LANG_", "PLAT_", "OTYPE_", "ITYPE_", "INVID_", "OUTVID_", "TEAM_", "CLIENT_")
        for col in df.columns:
            if df[col].dtype == object and len(df) > 0:
                sample = str(df[col].iloc[0])
                if any(sample.startswith(prefix) for prefix in id_prefixes):
                    return {"passed": False, "warning": f"Column '{col}' contains raw IDs (e.g. {sample}). A dimension JOIN is missing."}
        if len(df) > 20000:
            return {"passed": False, "warning": "Result exceeds 20,000 rows. Probable Cartesian JOIN. Add GROUP BY or check JOIN conditions."}
        return {"passed": True, "warning": None}

    @staticmethod
    def run_pipeline(question: str, schema: str, examples: list) -> dict:
        t_plan = time.perf_counter()
        plan = SemanticEngine.plan_query(question, schema)
        plan_ms = round((time.perf_counter() - t_plan) * 1000, 1)
        conn, fix_hint, attempts = sqlite3.connect(Config.DB_PATH), "", []
        for attempt in range(1, Config.MAX_RETRIES + 2):
            t0 = time.perf_counter()
            sql, filters, reason = SemanticEngine.generate_sql(question, schema, examples, fix_hint, plan)
            gen_ms = round((time.perf_counter() - t0) * 1000, 1)
            if sql is None:
                attempts.append({"attempt": attempt, "sql": None, "verdict": "GENERATION_FAILED", "reason": reason, "gen_ms": gen_ms, "ver_ms": 0})
                conn.close()
                return {"sql": None, "filters": [], "df": None, "error": reason, "verification": None, "sanity": None, "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
            t1 = time.perf_counter()
            ver_result = SemanticEngine.verify_sql(question, sql, schema)
            ver_ms = round((time.perf_counter() - t1) * 1000, 1)
            attempts.append({"attempt": attempt, "sql": sql, "verdict": ver_result.get("verdict"), "reason": ver_result.get("reason"), "fix_hint": ver_result.get("fix_hint", ""), "gen_ms": gen_ms, "ver_ms": ver_ms})
            if ver_result.get("verdict") == "PASS":
                try:
                    df = pd.read_sql_query(sql, conn)
                    sanity = PipelineOrchestrator.sanity_check(question, df)
                except Exception as e:
                    conn.close()
                    return {"sql": sql, "filters": filters, "df": None, "error": str(e), "verification": ver_result, "sanity": None, "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
                conn.close()
                return {"sql": sql, "filters": filters, "df": df, "error": None, "verification": ver_result, "sanity": sanity, "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
            fix_hint = ver_result.get("fix_hint", "")
            if attempt >= Config.MAX_RETRIES + 1:
                try:
                    df = pd.read_sql_query(sql, conn)
                except Exception:
                    df = None
                conn.close()
                return {"sql": sql, "filters": filters, "df": df, "error": None, "verification": ver_result, "sanity": {"passed": False, "warning": "Max retries reached."}, "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
        conn.close()
        return {"sql": None, "filters": [], "df": None, "error": "Pipeline did not produce a result.", "verification": None, "sanity": None, "plan": plan, "plan_ms": plan_ms, "attempts": attempts}


DB_PATH = Config.DB_PATH


def initialize_database():
    DatabaseManager.initialize_database()


def generate_nl_answer(question: str, df: pd.DataFrame) -> str:
    return SemanticEngine.generate_nl_answer(question, df)


def execute_pipeline(question: str, saved_kpis: list[tuple[str, str]] | None = None) -> dict:
    DatabaseManager.initialize_database()
    examples = BM25Retriever.load_examples()
    schema_collection, kpi_collection = KnowledgeBase.setup_chroma_db(saved_kpis=saved_kpis)
    intent = SemanticEngine.route_query(question)
    if intent.get("route") == "KPI":
        results = kpi_collection.query(query_texts=[question], n_results=3)
        docs = results["documents"][0] if results["documents"] else []
        ids = results["ids"][0] if results["ids"] else []
        kpi_matches = []
        for idx, doc in zip(ids, docs):
            definition = doc.split("Definition:", 1)[1].strip() if "Definition:" in doc else doc
            kpi_matches.append({"name": idx, "definition": definition})
        return {
            "question": question, "response_type": "information", "route": "KPI", "route_reason": intent.get("reason"),
            "answer_nl": SemanticEngine.kpi_rag_answer(question, kpi_collection), "kpi_matches": kpi_matches,
            "plan": None, "plan_ms": 0, "retrieved_examples": [], "attempts": [], "sql": None, "filters": [],
            "df_records": [], "columns": [], "error": None, "verification": None, "sanity": None,
        }
    retrieved = KnowledgeBase.retrieve_relevant_tables(question, schema_collection, k=Config.RAG_TOP_TABLES)
    final_tables = KnowledgeBase.expand_schema_graph(retrieved)
    conn_check = sqlite3.connect(Config.DB_PATH)
    filtered_schema = DatabaseManager.build_schema_with_pragma(conn_check, selected_tables=final_tables)
    conn_check.close()
    selected = BM25Retriever.retrieve(question, examples)
    result = PipelineOrchestrator.run_pipeline(question, filtered_schema, selected)
    payload = {
        "question": question, "response_type": "query", "route": "SQL", "route_reason": intent.get("reason"),
        "plan": result.get("plan"), "plan_ms": result.get("plan_ms"), "retrieved_examples": selected,
        "attempts": result.get("attempts", []), "sql": result.get("sql"), "filters": result.get("filters", []),
        "df_records": [], "columns": [], "error": result.get("error"), "verification": result.get("verification"),
        "sanity": result.get("sanity"), "answer_nl": None, "schema_tables": final_tables,
    }
    df = result.get("df")
    if df is not None and not df.empty:
        payload["df_records"] = df.to_dict(orient="records")
        payload["columns"] = df.columns.tolist()
        payload["answer_nl"] = SemanticEngine.generate_nl_answer(question, df)
    return payload
