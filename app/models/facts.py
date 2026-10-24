"""Fact table ORM models — exact match to the star-schema DDL."""

from sqlalchemy import Column, Integer, Boolean, Text, ForeignKey, String, Interval
from app.models.base import Base


class FactInputVideoOperations(Base):
    __tablename__ = "Fact_Input_Video_Operations"

    Fact_Input_ID = Column(String(255), primary_key=True)
    Input_Video_ID = Column(String(255), ForeignKey("Dim_Input_Video.Input_Video_ID"), nullable=False)
    Channel_ID = Column(String(255), ForeignKey("Dim_Channel_Client.Channel_ID"), nullable=False)
    User_ID = Column(String(255), ForeignKey("Dim_User_Team.User_ID"), nullable=False)
    Input_Type_ID = Column(String(255), ForeignKey("Dim_Input_Type.Input_Type_ID"), nullable=False)
    Output_Type_ID = Column(String(255), ForeignKey("Dim_Output_Type.Output_Type_ID"), nullable=False)
    Language_ID = Column(String(255), ForeignKey("Dim_Language.Language_ID"), nullable=False)
    Upload_Date_ID = Column(String(255), ForeignKey("Dim_Date.Date_ID"), nullable=False)
    Uploaded_Duration = Column(Interval)


class FactOutputVideoOperations(Base):
    __tablename__ = "Fact_Output_Video_Operations"

    Fact_Output_ID = Column(String(255), primary_key=True)
    Output_Video_ID = Column(String(255), ForeignKey("Dim_Output_Video.Output_Video_ID"), nullable=False)
    Output_Type_ID = Column(String(255), ForeignKey("Dim_Output_Type.Output_Type_ID"), nullable=False)
    Language_ID = Column(String(255), ForeignKey("Dim_Language.Language_ID"), nullable=False)
    Create_Date_ID = Column(String(255), ForeignKey("Dim_Date.Date_ID"), nullable=False)
    Created_Duration = Column(Interval)
    Fact_Input_ID = Column(String(255), ForeignKey("Fact_Input_Video_Operations.Fact_Input_ID"), nullable=False)


class FactPublishInformation(Base):
    __tablename__ = "Fact_Publish_Information"

    Fact_Publish_ID = Column(String(255), primary_key=True)
    Platform_ID = Column(String(255), ForeignKey("Dim_Platform.Platform_ID"), nullable=False)
    Published_Date_ID = Column(String(255), ForeignKey("Dim_Date.Date_ID"), nullable=False)
    Published_Duration = Column(Interval)
    Is_Billable = Column(Boolean)
    Fact_Output_ID = Column(String(255), ForeignKey("Fact_Output_Video_Operations.Fact_Output_ID"), nullable=False)
    Published_URL = Column(Text)


class FactDataQuality(Base):
    __tablename__ = "Fact_Data_Quality"

    DQ_Log_ID = Column(String(255), primary_key=True)
    Input_Video_ID = Column(String(255), ForeignKey("Dim_Input_Video.Input_Video_ID"), nullable=False)
    Error_Type = Column(Text, nullable=False)
    Log_Date_ID = Column(String(255), ForeignKey("Dim_Date.Date_ID"), nullable=False)
