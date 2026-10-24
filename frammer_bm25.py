import sqlite3
import pandas as pd
import streamlit as st
import google.generativeai as genai
import os, re, json, math, time
import threading

# ══════════════════════════════════════════
# 1. CONFIGURATION
# ══════════════════════════════════════════
API_KEYS_RAW  = os.getenv("GEMINI_API_KEYS", "")
API_KEY       = os.getenv("GEMINI_API_KEY", "")
DB_PATH       = 'frammer_analytics.db'
FEW_SHOT_PATH = 'few_shot_examples (1).json'
MAX_RETRIES   = 2
TOP_K         = 3

_API_KEY_ROTATION_LOCK = threading.Lock()
_API_KEY_ROTATION_INDEX = 0


def _parse_api_keys() -> list[str]:
    values: list[str] = []
    for raw_value in (API_KEYS_RAW, API_KEY):
        if not raw_value:
            continue
        values.extend(part.strip() for part in re.split(r"[\r\n,]+", raw_value) if part.strip())
    return list(dict.fromkeys(values))


def _next_key_order(api_keys: list[str]) -> list[str]:
    if len(api_keys) <= 1:
        return api_keys
    global _API_KEY_ROTATION_INDEX
    with _API_KEY_ROTATION_LOCK:
        start_index = _API_KEY_ROTATION_INDEX % len(api_keys)
        _API_KEY_ROTATION_INDEX += 1
    return api_keys[start_index:] + api_keys[:start_index]


def _is_rate_limit_error(exc: Exception) -> bool:
    lowered = str(exc).lower()
    markers = ("429", "rate limit", "too many requests", "resource_exhausted", "quota", "retry_delay")
    return any(marker in lowered for marker in markers)


def _generate_content(prompt: str):
    api_keys = _parse_api_keys()
    if not api_keys:
        raise RuntimeError("Gemini API keys are not configured. Set GEMINI_API_KEYS or GEMINI_API_KEY.")

    last_error: Exception | None = None
    for api_key in _next_key_order(api_keys):
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-2.5-flash')
            return model.generate_content(prompt)
        except Exception as exc:
            last_error = exc

    if last_error and _is_rate_limit_error(last_error):
        raise RuntimeError("The AI service is temporarily busy. Please try again in a moment.")
    raise RuntimeError("The AI service is temporarily unavailable. Please try again shortly.")

# ══════════════════════════════════════════
# 2. DATABASE INITIALIZATION
# ══════════════════════════════════════════
def initialize_database():
    if os.path.exists(DB_PATH):
        # Check if the DB actually has tables — an empty/corrupt file should be rebuilt
        try:
            check_conn = sqlite3.connect(DB_PATH)
            table_count = check_conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            check_conn.close()
            if table_count > 0:
                return
        except Exception:
            pass  # If the DB is corrupt, fall through and rebuild
    conn = sqlite3.connect(DB_PATH)
    data_dir = r"data/"
    csv_files = [
        os.path.join(data_dir, "dim_channel_client.csv"),
        os.path.join(data_dir, "dim_date.csv"),
        os.path.join(data_dir, "dim_input_type.csv"),
        os.path.join(data_dir, "dim_input_video.csv"),
        os.path.join(data_dir, "dim_language.csv"),
        os.path.join(data_dir, "dim_output_type.csv"),
        os.path.join(data_dir, "dim_output_video.csv"),
        os.path.join(data_dir, "dim_platform.csv"),
        os.path.join(data_dir, "dim_user_team.csv"),
        os.path.join(data_dir, "fact_input_video_operations.csv"),
        os.path.join(data_dir, "fact_output_video_operations.csv"),
        os.path.join(data_dir, "fact_publish_information.csv"),
        os.path.join(data_dir, "fact_data_quality.csv"),
    ]
    for file in csv_files:
        if os.path.exists(file):
            table_name = os.path.basename(file).replace('.csv', '')
            df = pd.read_csv(file)
            if table_name == 'fact_input_video_operations':
                df['User_ID']    = df['User_ID'].astype(str)
                df['Channel_ID'] = df['Channel_ID'].astype(str)
            df.to_sql(table_name, conn, if_exists='replace', index=False)
            print(f"Loaded: {table_name}")
    conn.close()

# ══════════════════════════════════════════
# 3. DYNAMIC SCHEMA USING PRAGMA
#    Reads directly from SQLite's internal
#    metadata — always accurate, never stale
# ══════════════════════════════════════════
TABLE_ANNOTATIONS = {
    "dim_channel_client":           {"description": "Channels and parent media companies.", "fk_hints": ""},
    "dim_date":                     {"description": "Calendar dimension. Month 1-12, Quarter 1-4.", "fk_hints": ""},
    "dim_input_type":               {"description": "Type of raw video. Values: interview, news bulletin, special reports, speech, debate, press conference, discussion-show, sports show, podcast, drama, in-brief.", "fk_hints": ""},
    "dim_language":                 {"description": "Language lookup. Values: en, hi, mr, mix, es, ar.", "fk_hints": ""},
    "dim_output_type":              {"description": "Output clip format. Values: Full Package, Key moments, Chapters, My Key moments, Summary.", "fk_hints": ""},
    "dim_output_video":             {"description": "Output video headline only. Published_URL lives in fact_publish_information.", "fk_hints": ""},
    "dim_platform":                 {"description": "Platform lookup. Values: Facebook, Instagram, LinkedIn, Reels, Shorts, X, Youtube, Threads.", "fk_hints": ""},
    "dim_user_team":                {"description": "Users and their teams.", "fk_hints": ""},
    "fact_input_video_operations":  {
        "description": "PIPELINE STEP 1 — Every upload event. 8000 rows. Uploaded_Duration is HH:MM:SS string (convert to seconds for math).",
        "fk_hints": "Channel_ID→dim_channel_client, User_ID→dim_user_team, Input_Video_ID→dim_input_video, Input_Type_ID→dim_input_type, Language_ID→dim_language, Upload_Date_ID→dim_date"
    },
    "fact_output_video_operations": {
        "description": "PIPELINE STEP 2 — Every processed clip. 13165 rows. Created_Duration is HH:MM:SS string. Links to uploads via Fact_Input_ID.",
        "fk_hints": "Output_Video_ID→dim_output_video, Output_Type_ID→dim_output_type, Language_ID→dim_language, Created_Date_ID→dim_date, Fact_Input_ID→fact_input_video_operations"
    },
    "fact_publish_information":     {
        "description": "PIPELINE STEP 3 — Every publish event. 17933 rows. Published_Duration is HH:MM:SS string. Is_Billable stored as integer 1 (billable) or 0 (not billable).",
        "fk_hints": "Platform_ID→dim_platform, Published_Date_ID→dim_date, Fact_Output_ID→fact_output_video_operations"
    },
    "fact_data_quality":            {
        "description": "Error log. Use for questions about failures, missing audio, corrupted files.",
        "fk_hints": "Log_Date_ID→dim_date"
    },
}

def build_schema_with_pragma(conn) -> str:
    """
    PRAGMA-based dynamic schema builder.
    Step 1 — sqlite_master gives all table names.
    Step 2 — PRAGMA table_info() gives every column name and type for each table.
    Result  — a CREATE TABLE string that exactly mirrors the real database.
    Note    — PRAGMA is SQLite-specific. Works perfectly here since we use SQLite.
    """
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = [row[0] for row in cursor.fetchall()]

    lines = []
    for table in tables:
        ann = TABLE_ANNOTATIONS.get(table, {})
        if ann.get("description"):
            lines.append(f"-- {ann['description']}")
        if ann.get("fk_hints"):
            lines.append(f"-- FOREIGN KEYS: {ann['fk_hints']}")

        # PRAGMA table_info returns:
        # (cid, name, type, notnull, default_value, pk)
        cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
        col_defs = [f"    {c[1]} {c[2] or 'VARCHAR'}" for c in cols]

        lines.append(f"CREATE TABLE {table} (")
        lines.append(",\n".join(col_defs))
        lines.append(");\n")

    return "\n".join(lines)

# ══════════════════════════════════════════
# 4. BM25 RETRIEVAL
#    Selects top-K most relevant few-shot
#    examples from the JSON file.
#
#    BM25 advantages over TF-IDF:
#    - No matrix build step → 17x faster
#    - Term saturation: word appearing 10x
#      does not score 10x higher
#    - Document length normalisation: short
#      and long questions treated fairly
#    - IDF pre-computed once at startup
# ══════════════════════════════════════════
@st.cache_data
def load_examples():
    if not os.path.exists(FEW_SHOT_PATH):
        return []
    with open(FEW_SHOT_PATH) as f:
        return json.load(f)

def _tokenize(text: str) -> list:
    """Lowercase, remove punctuation, split on whitespace."""
    return re.sub(r'[^a-z0-9 ]', '', text.lower()).split()

def _build_bm25_index(corpus: list, k1: float = 1.5, b: float = 0.75) -> dict:
    """
    Pre-compute BM25 index from a list of strings.
    k1  — term frequency saturation (1.2–2.0 typical)
    b   — length normalisation strength (0.75 typical)
    """
    tokenized = [_tokenize(doc) for doc in corpus]
    N         = len(tokenized)
    avgdl     = sum(len(d) for d in tokenized) / max(N, 1)

    # Document frequency: how many documents contain each word
    df = {}
    for doc in tokenized:
        for word in set(doc):
            df[word] = df.get(word, 0) + 1

    # IDF: penalises words that appear in many documents
    idf = {
        word: math.log((N - freq + 0.5) / (freq + 0.5) + 1)
        for word, freq in df.items()
    }

    return {"tokenized": tokenized, "idf": idf, "avgdl": avgdl, "k1": k1, "b": b}

def _bm25_score(query_tokens: list, index: dict) -> list:
    """Score every document in the index against the query tokens."""
    tokenized = index["tokenized"]
    idf       = index["idf"]
    avgdl     = index["avgdl"]
    k1        = index["k1"]
    b         = index["b"]

    scores = []
    for doc_tokens in tokenized:
        dl   = len(doc_tokens)
        freq = {}
        for word in doc_tokens:
            freq[word] = freq.get(word, 0) + 1

        score = 0.0
        for word in query_tokens:
            if word in idf:
                tf        = freq.get(word, 0)
                numerator = idf[word] * tf * (k1 + 1)
                denomin   = tf + k1 * (1 - b + b * dl / avgdl)
                score    += numerator / denomin
        scores.append(score)
    return scores

def bm25_retrieve(query: str, examples: list, k: int = TOP_K) -> list:
    """
    Main retrieval function using BM25.
    Returns top-k most relevant examples from the library.
    If library has fewer examples than k, returns all.
    """
    if not examples:
        return []
    if len(examples) <= k:
        return examples

    corpus = [ex["question"] for ex in examples]
    index  = _build_bm25_index(corpus)
    qtoks  = _tokenize(query)
    scores = _bm25_score(qtoks, index)

    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
    return [examples[i] for i in top_indices]

# ══════════════════════════════════════════
# 5. QUERY PLANNER
#    Analyses the question BEFORE SQL generation.
#    Classifies as SIMPLE or MULTI_STEP.
#    Detects if duration math is needed.
#    For MULTI_STEP, produces ordered sub-steps
#    that guide the SQL generator.
# ══════════════════════════════════════════
PLANNER_PROMPT = """
You are a query planning expert for Frammer AI's video analytics database.
Analyse the user's question and produce an execution plan.

The database has a 3-step pipeline:
  fact_input_video_operations  (uploads)
  fact_output_video_operations (processed clips, linked via Fact_Input_ID)
  fact_publish_information     (publish events, linked via Fact_Output_ID)
Plus dimension tables: dim_channel_client, dim_date, dim_input_type,
  dim_input_video, dim_language, dim_output_type, dim_output_video,
  dim_platform, dim_user_team, and fact_data_quality.

Duration columns (Uploaded_Duration, Created_Duration, Published_Duration)
are stored as HH:MM:SS strings and need conversion to seconds for any math.

Return ONLY a raw JSON object. No markdown. No backticks.
Keys:
  "complexity"          : "SIMPLE" or "MULTI_STEP"
  "plan"                : list of step objects, each with:
                          {"step": int, "description": str, "tables": [str]}
                          For SIMPLE questions, return a single step.
  "duration_math_needed": true if the question asks for SUM, AVG, total,
                          average, longest, shortest, or any arithmetic
                          on duration/time/length columns. false otherwise.
  "duration_operation"  : "SUM" | "AVG" | "MAX" | "MIN" | "DIFF" | "COMPARE" | null
"""

def plan_query(question: str) -> dict:
    """Query planner: analyses question complexity before SQL generation."""
    prompt = f"{PLANNER_PROMPT}\nQUESTION: {question}\nJSON:"
    resp   = _generate_content(prompt)
    raw    = re.sub(r"```json|```", "", resp.text.strip()).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Default: treat as simple, no duration math
        return {
            "complexity": "SIMPLE",
            "plan": [{"step": 1, "description": question, "tables": []}],
            "duration_math_needed": False,
            "duration_operation": None
        }

# ══════════════════════════════════════════
# 6. LAYER 1 — SQL GENERATION
# ══════════════════════════════════════════
STATIC_INSTRUCTIONS = """
You are an expert data analyst for Frammer AI.
Convert the user's plain English question into a valid SQLite query.

PIPELINE CHAIN:
fact_input_video_operations (Step 1: uploads)
        | Fact_Input_ID
        v
fact_output_video_operations (Step 2: processed clips)
        | Fact_Output_ID
        v
fact_publish_information (Step 3: publish events)

RULES:
- Use LEFT JOIN for funnel analysis so channels with zero at any stage still appear.
- Use COUNT(DISTINCT ...) when chaining across multiple fact tables.
- Duration columns (Uploaded_Duration, Created_Duration, Published_Duration) are
  HH:MM:SS strings. To do math (SUM, AVG, compare, subtract, etc.), FIRST convert
  to seconds using this expression:
    (CAST(SUBSTR(col, 1, 2) AS INTEGER) * 3600 +
     CAST(SUBSTR(col, 4, 2) AS INTEGER) * 60 +
     CAST(SUBSTR(col, 7, 2) AS INTEGER))
  Then wrap your aggregation around it, e.g.:
    SUM(...) or AVG(...)
  To convert total seconds back to HH:MM:SS for display, use:
    printf('%02d:%02d:%02d', result/3600, (result%3600)/60, result%60)
- Is_Billable is stored as integer 1 (billable) or 0 (not billable), not a string.
- When filtering by name (e.g. 'Instagram', 'hi', 'Key moments'), always JOIN the
  dimension table and filter on the name column, not the ID column.

Return ONLY a raw JSON object with no markdown and no backticks.
Keys: "sql" (string), "filters_applied" (list of strings).
If unanswerable: {"sql": null, "filters_applied": [], "reason": "..."}
"""

def _build_generation_prompt(question: str, schema: str, examples: list, plan: dict = None) -> str:
    ex_block = ""
    if examples:
        ex_block = "EXAMPLES (follow these patterns):\n"
        for i, ex in enumerate(examples, 1):
            ex_block += f'Example {i}: "{ex["question"]}"\nSQL: {ex["sql"]}\n\n'

    plan_block = ""
    if plan and plan.get("complexity") == "MULTI_STEP":
        plan_block = "QUERY PLAN (follow these steps to build your SQL):\n"
        for step in plan.get("plan", []):
            tables_str = ", ".join(step.get("tables", []))
            plan_block += f"  Step {step['step']}: {step['description']}"
            if tables_str:
                plan_block += f" (tables: {tables_str})"
            plan_block += "\n"
        plan_block += "\nCombine all steps into a SINGLE SQL query using JOINs or subqueries.\n\n"

    if plan and plan.get("duration_math_needed"):
        op = plan.get("duration_operation", "SUM")
        plan_block += f"NOTE: This question requires {op} on duration columns. Remember to convert HH:MM:SS to seconds first.\n\n"

    return f"{STATIC_INSTRUCTIONS}\n\nSCHEMA:\n{schema}\n\n{plan_block}{ex_block}QUESTION: {question}\nJSON:"

def generate_sql(question: str, schema: str, examples: list, fix_hint: str = "", plan: dict = None) -> tuple:
    q      = question if not fix_hint else f"{question}\n\nPREVIOUS ATTEMPT FAILED. FIX REQUIRED: {fix_hint}"
    prompt = _build_generation_prompt(q, schema, examples, plan)
    resp   = _generate_content(prompt)
    raw    = re.sub(r"```json|```", "", resp.text.strip()).strip()
    try:
        p = json.loads(raw)
        return p.get("sql"), p.get("filters_applied", []), p.get("reason")
    except json.JSONDecodeError:
        return None, [], "Could not parse LLM response"

# ══════════════════════════════════════════
# 6. LAYER 2 — VERIFICATION LLM
#    A second Gemini call acting as judge.
#    Checks 7 failure types and returns
#    PASS/FAIL + a specific fix hint.
# ══════════════════════════════════════════
VERIFIER_INSTRUCTIONS = """
You are a SQL verification expert for Frammer AI.
Check whether the generated SQL correctly and completely answers the user's question.

Failure types to check:
A. SEMANTIC MISMATCH    — SQL answers a different question than asked
B. WRONG TABLE          — wrong fact table used for the question type
C. MISSING JOIN         — dimension table not joined, returns raw IDs instead of names
D. WRONG FILTER VALUE   — e.g. Language = 'hindi' instead of 'hi'
E. WRONG AGGREGATION    — COUNT(*) where COUNT(DISTINCT) is needed due to JOINs
F. WRONG JOIN TYPE      — INNER JOIN silently drops rows, LEFT JOIN needed
G. INCOMPLETE ANSWER    — question asks multiple metrics but SQL returns only one
H. RAW DURATION MATH    — SUM/AVG/arithmetic on a duration column (Uploaded_Duration,
   Created_Duration, Published_Duration) WITHOUT first converting to seconds using
   CAST(SUBSTR(...)) formula. This will produce garbage results.

Return ONLY a raw JSON object. No markdown. No backticks.
Keys:
  "verdict"  : "PASS" or "FAIL"
  "reason"   : one sentence explaining what is right or wrong
  "fix_hint" : if FAIL, one specific instruction to fix the SQL. Empty string if PASS.
"""

def verify_sql(question: str, sql: str, schema: str) -> dict:
    """Layer 2: LLM-as-judge verification."""
    prompt = f"""{VERIFIER_INSTRUCTIONS}

SCHEMA:
{schema}

USER QUESTION: {question}

GENERATED SQL:
{sql}

JSON VERDICT:"""
    resp = _generate_content(prompt)
    raw  = re.sub(r"```json|```", "", resp.text.strip()).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"verdict": "PASS", "reason": "Verifier parse error — defaulting to pass", "fix_hint": ""}

# ══════════════════════════════════════════
# 7. LAYER 3 — SANITY CHECK
#    Rule-based checks on the actual result.
#    No LLM call. Catches what the verifier
#    cannot because it never runs the SQL.
# ══════════════════════════════════════════
def sanity_check(question: str, df: pd.DataFrame) -> dict:
    """Layer 3: pure rule-based checks on the returned dataframe."""
    if df is None or df.empty:
        return {"passed": False, "warning": "Query returned 0 rows. Filter may be too strict or use a wrong value (e.g. 'hindi' instead of 'hi')."}

    group_keywords = ["per channel", "per team", "per platform", "per language",
                      "by channel", "by team", "each channel", "each team"]
    if any(kw in question.lower() for kw in group_keywords) and len(df) == 1:
        return {"passed": False, "warning": "Question implies multiple groups but only 1 row returned. GROUP BY may be missing or filter is over-restrictive."}

    for col in df.columns:
        if df[col].dtype == object and len(df) > 0:
            sample = str(df[col].iloc[0])
            if re.match(r'^(CHANNEL|USER|LANG|PLAT|OTYPE|ITYPE)_[A-F0-9]{6,}', sample):
                return {"passed": False, "warning": f"Column '{col}' contains raw IDs (e.g. {sample}). A dimension JOIN is missing."}

    numeric_cols = df.select_dtypes(include='number').columns
    if len(df) == 1 and len(numeric_cols) == 1:
        val = df[numeric_cols[0]].iloc[0]
        if val > 100_000:
            return {"passed": False, "warning": f"Result is {val:,} — suspiciously large. Possible Cartesian JOIN. Consider COUNT(DISTINCT ...)."}

    return {"passed": True, "warning": None}

# ══════════════════════════════════════════
# 8. FULL VERIFIED PIPELINE
# ══════════════════════════════════════════
def run_pipeline(question: str, schema: str, examples: list) -> dict:
    # ── Step 0: Query Planner ──
    t_plan    = time.perf_counter()
    plan      = plan_query(question)
    plan_ms   = round((time.perf_counter() - t_plan) * 1000, 1)

    conn      = sqlite3.connect(DB_PATH)
    fix_hint  = ""
    attempts  = []

    for attempt in range(1, MAX_RETRIES + 2):
        t0              = time.perf_counter()
        sql, filters, reason = generate_sql(question, schema, examples, fix_hint, plan)
        gen_ms          = round((time.perf_counter() - t0) * 1000, 1)

        if sql is None:
            attempts.append({"attempt": attempt, "sql": None, "verdict": "GENERATION_FAILED",
                             "reason": reason, "gen_ms": gen_ms, "ver_ms": 0})
            break

        t1         = time.perf_counter()
        ver_result = verify_sql(question, sql, schema)
        ver_ms     = round((time.perf_counter() - t1) * 1000, 1)

        attempts.append({
            "attempt":  attempt,
            "sql":      sql,
            "verdict":  ver_result.get("verdict"),
            "reason":   ver_result.get("reason"),
            "fix_hint": ver_result.get("fix_hint", ""),
            "gen_ms":   gen_ms,
            "ver_ms":   ver_ms,
        })

        if ver_result.get("verdict") == "PASS":
            try:
                df     = pd.read_sql_query(sql, conn)
                sanity = sanity_check(question, df)
            except Exception as e:
                conn.close()
                return {"sql": sql, "filters": filters, "df": None, "error": str(e),
                        "verification": ver_result, "sanity": None,
                        "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
            conn.close()
            return {"sql": sql, "filters": filters, "df": df, "error": None,
                    "verification": ver_result, "sanity": sanity,
                    "plan": plan, "plan_ms": plan_ms, "attempts": attempts}
        else:
            fix_hint = ver_result.get("fix_hint", "")
            if attempt >= MAX_RETRIES + 1:
                try:
                    df = pd.read_sql_query(sql, conn)
                except Exception:
                    df = None
                conn.close()
                return {"sql": sql, "filters": filters, "df": df, "error": None,
                        "verification": ver_result,
                        "sanity": {"passed": False, "warning": "Max retries reached. Result may be inaccurate."},
                        "plan": plan, "plan_ms": plan_ms, "attempts": attempts}

    conn.close()
    return {"sql": None, "filters": [], "df": None, "error": reason,
            "verification": None, "sanity": None,
            "plan": plan, "plan_ms": plan_ms, "attempts": attempts}

# ══════════════════════════════════════════
# 9. HELPERS
# ══════════════════════════════════════════
def generate_nl_answer(question: str, df: pd.DataFrame) -> str:
    if df is None or df.empty:
        return "No data found."
    prompt = f'User asked: "{question}"\nData:\n{df.head(5).to_string(index=False)}\nWrite ONE concise sentence summarising the key insight. No SQL or jargon.'
    return _generate_content(prompt).text.strip()

def smart_chart(df: pd.DataFrame):
    if df is None or df.empty or len(df.columns) < 2:
        return
    cols         = df.columns.tolist()
    numeric_cols = df.select_dtypes(include='number').columns.tolist()
    if not numeric_cols:
        return
    is_time = any(w in cols[0].lower() for w in ['month', 'year', 'date', 'week', 'quarter'])
    # Line chart only for actual trends (6+ data points); bar chart for comparisons
    if is_time and len(df) >= 6:
        st.line_chart(data=df, x=cols[0], y=numeric_cols)
    elif len(numeric_cols) >= 2:
        st.bar_chart(data=df.set_index(cols[0])[numeric_cols])
    else:
        st.bar_chart(data=df, x=cols[0], y=numeric_cols[0])

# ══════════════════════════════════════════
# 10. STREAMLIT UI
# ══════════════════════════════════════════
st.set_page_config(page_title="Frammer AI — BM25", layout="wide")
st.title("Frammer AI Analytics")
st.caption("Pipeline: Query Planner → BM25 retrieval → SQL generation → LLM verification → Sanity check")

if not os.path.exists(DB_PATH):
    with st.spinner("Building database..."):
        initialize_database()
else:
    initialize_database()

examples = load_examples()

conn_check     = sqlite3.connect(DB_PATH)
dynamic_schema = build_schema_with_pragma(conn_check)
conn_check.close()

with st.sidebar:
    st.markdown("### Method")
    st.markdown("**Planner:** LLM query decomposition")
    st.markdown("**Retrieval:** BM25")
    st.markdown("**Schema:** PRAGMA table_info()")
    st.markdown("**Duration math:** HH:MM:SS → seconds")
    st.markdown("**Verification:** LLM-as-judge")
    st.markdown("**Sanity check:** Rule-based")
    st.markdown(f"**Max retries:** {MAX_RETRIES}")
    st.markdown(f"**Examples loaded:** {len(examples)}")

user_input = st.text_input(
    "Ask a question:",
    placeholder="e.g. Which team uploaded the most Hindi videos?"
)

if st.button("Generate & Verify", type="primary"):
    if not user_input.strip():
        st.warning("Please enter a question.")
    else:
        with st.spinner("Planning → BM25 retrieval → generating → verifying → sanity check..."):
            t_start   = time.perf_counter()
            selected  = bm25_retrieve(user_input, examples)
            result    = run_pipeline(user_input, dynamic_schema, selected)
            total_ms  = round((time.perf_counter() - t_start) * 1000, 1)

        st.caption(f"Total pipeline time: {total_ms}ms")

        # Show query plan
        plan = result.get("plan", {})
        plan_ms = result.get("plan_ms", 0)
        complexity = plan.get("complexity", "SIMPLE")
        with st.expander(f"Query Plan — {complexity}  |  {plan_ms}ms"):
            for step in plan.get("plan", []):
                tables_str = ", ".join(step.get("tables", []))
                st.markdown(f"**Step {step.get('step', '?')}:** {step.get('description', '')}")
                if tables_str:
                    st.caption(f"Tables: {tables_str}")
            if plan.get("duration_math_needed"):
                st.info(f"Duration math detected — operation: {plan.get('duration_operation', 'N/A')}")

        with st.expander("Retrieved examples (BM25)"):
            for ex in selected:
                st.markdown(f"- {ex['question']}")

        st.subheader("Pipeline trace")
        for a in result["attempts"]:
            verdict = a.get("verdict", "?")
            with st.expander(f"Attempt {a['attempt']} — {verdict}  |  gen: {a['gen_ms']}ms  |  verify: {a['ver_ms']}ms"):
                st.markdown(f"**Verifier reason:** {a.get('reason', '—')}")
                if a.get("fix_hint"):
                    st.markdown(f"**Fix hint:** {a['fix_hint']}")
                if a.get("sql"):
                    st.code(a["sql"], language="sql")

        ver = result.get("verification")
        if ver:
            if ver.get("verdict") == "PASS":
                st.success(f"Verification passed — {ver.get('reason')}")
            else:
                st.warning(f"Verification failed after retries — {ver.get('reason')}")

        sanity = result.get("sanity")
        if sanity and not sanity.get("passed"):
            st.warning(f"Sanity check: {sanity.get('warning')}")

        df = result.get("df")
        if result.get("error") and df is None:
            st.error(f"Error: {result['error']}")
        elif df is not None and not df.empty:
            st.success(f"💡 {generate_nl_answer(user_input, df)}")
            for f in result.get("filters", []):
                st.markdown(f"- {f}")
            st.dataframe(df, use_container_width=True)
            smart_chart(df)
            st.download_button("Download CSV", df.to_csv(index=False).encode(), "result.csv", "text/csv")
        elif df is not None and df.empty:
            st.warning("Query returned no results.")
