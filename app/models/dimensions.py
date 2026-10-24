"""Dimension table ORM models — exact match to the star-schema DDL."""

from sqlalchemy import Column, Integer, String, Text, Date
from app.models.base import Base


class DimChannelClient(Base):
    __tablename__ = "Dim_Channel_Client"

    Channel_ID = Column(String(255), primary_key=True)
    Channel_Name = Column(String(255), nullable=False)
    Client_ID = Column(String(255), nullable=False)
    Client_Name = Column(String(255), nullable=False)


class DimDate(Base):
    __tablename__ = "Dim_Date"

    Date_ID = Column(String(255), primary_key=True)
    Full_Date = Column(Date, nullable=False)
    Day_of_Week = Column(String(20))
    Week_Number = Column(Integer)
    Month = Column(Integer)
    Quarter = Column(Integer)
    Year = Column(Integer)


class DimInputType(Base):
    __tablename__ = "Dim_Input_Type"

    Input_Type_ID = Column(String(255), primary_key=True)
    Input_Type = Column(String(100), nullable=False)


class DimInputVideo(Base):
    __tablename__ = "Dim_Input_Video"

    Input_Video_ID = Column(String(255), primary_key=True)
    Headline = Column(Text, nullable=False)
    Source_Name = Column(String(255))
    Source_URL = Column(Text)


class DimLanguage(Base):
    __tablename__ = "Dim_Language"

    Language_ID = Column(String(255), primary_key=True)
    Language_Name = Column(String(100), nullable=False)


class DimOutputType(Base):
    __tablename__ = "Dim_Output_Type"

    Output_Type_ID = Column(String(255), primary_key=True)
    Output_Type = Column(String(100), nullable=False)


class DimOutputVideo(Base):
    __tablename__ = "Dim_Output_Video"

    Output_Video_ID = Column(String(255), primary_key=True)
    Headline = Column(Text, nullable=False)


class DimPlatform(Base):
    __tablename__ = "Dim_Platform"

    Platform_ID = Column(String(255), primary_key=True)
    Platform_Name = Column(String(100), nullable=False)


class DimUserTeam(Base):
    __tablename__ = "Dim_User_Team"

    User_ID = Column(String(255), primary_key=True)
    User_Name = Column(String(255), nullable=False)
    Team_ID = Column(String(255), nullable=False)
    Team_Name = Column(String(255), nullable=False)
