"""Relational core (spec section 7). JSON columns hold structured, versioned payloads."""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, Boolean, Float
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(40), default="us")
    policy_config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"))
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="active")


class PortfolioSearch(Base):
    __tablename__ = "portfolio_searches"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    query_type: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(300))
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(40), default="CREATED")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    candidates: Mapped[list] = mapped_column(JSON, default=list)
    confirmed: Mapped[dict] = mapped_column(JSON, default=dict)
    portfolio_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Portfolio(Base):
    __tablename__ = "portfolios"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    entity: Mapped[dict] = mapped_column(JSON, default=dict)
    query_type: Mapped[str] = mapped_column(String(20), default="company")
    ownership_scope: Mapped[str] = mapped_column(String(60), default="current_owner")
    entity_size: Mapped[str] = mapped_column(String(20), default="large")
    data_mode: Mapped[str] = mapped_column(String(20), default="synthetic")
    provisional: Mapped[bool] = mapped_column(Boolean, default=False)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    unavailable_sources: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class PatentFamily(Base):
    __tablename__ = "patent_families"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    provider_family_id: Mapped[str] = mapped_column(String(80))
    family_type: Mapped[str] = mapped_column(String(40), default="simple")
    source_id: Mapped[str] = mapped_column(String(120), default="")


class PatentAsset(Base):
    __tablename__ = "patent_assets"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    family_id: Mapped[Optional[str]] = mapped_column(ForeignKey("patent_families.id"), nullable=True, index=True)
    publication_number: Mapped[str] = mapped_column(String(60))
    application_number: Mapped[str] = mapped_column(String(60), default="")
    jurisdiction: Mapped[str] = mapped_column(String(8), default="US")
    kind_code: Mapped[str] = mapped_column(String(8), default="")
    title: Mapped[str] = mapped_column(String(500))
    abstract: Mapped[str] = mapped_column(Text, default="")
    cpc: Mapped[str] = mapped_column(String(40), default="")
    technology: Mapped[str] = mapped_column(String(120), default="")
    filing_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    priority_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    grant_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiry_estimate: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="unknown")
    status_conflict: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    relationship_type: Mapped[str] = mapped_column(String(40), default="original")
    parent_publication: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    inventors: Mapped[list] = mapped_column(JSON, default=list)
    original_applicant: Mapped[str] = mapped_column(String(300), default="")
    current_owner: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    owner_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    ownership_issue: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    entity_size: Mapped[str] = mapped_column(String(20), default="large")
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    obligations: Mapped[list] = mapped_column(JSON, default=list)
    product_mappings: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)  # None = not supplied
    customer_inputs: Mapped[dict] = mapped_column(JSON, default=dict)
    data_as_of: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_status_check: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class OwnershipEvent(Base):
    __tablename__ = "ownership_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    assignee: Mapped[str] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(40))  # inventor / original_applicant / recorded_assignee / current_owner
    event_type: Mapped[str] = mapped_column(String(60))
    effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_id: Mapped[str] = mapped_column(String(200))
    confidence: Mapped[float] = mapped_column(Float, default=0.9)


class LegalStatusSnapshot(Base):
    __tablename__ = "legal_status_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    status: Mapped[str] = mapped_column(String(40))
    status_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_id: Mapped[str] = mapped_column(String(200))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    dimension: Mapped[str] = mapped_column(String(40), index=True)
    evidence_type: Mapped[str] = mapped_column(String(60))
    source_name: Mapped[str] = mapped_column(String(200))
    source_uri: Mapped[str] = mapped_column(String(500), default="")
    source_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    excerpt: Mapped[str] = mapped_column(Text, default="")
    reliability: Mapped[float] = mapped_column(Float, default=0.7)
    directness: Mapped[float] = mapped_column(Float, default=0.7)
    polarity: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), default="")


class CostActual(Base):
    """Historical (sunk) costs supplied by the customer - never mixed with forecasts."""
    __tablename__ = "cost_actuals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    category: Mapped[str] = mapped_column(String(60))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    incurred_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_id: Mapped[str] = mapped_column(String(200))


class DimensionInput(Base):
    """Analyst/customer-supplied rating for a dimension; latest row per (asset, dimension) wins."""
    __tablename__ = "dimension_inputs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    dimension: Mapped[str] = mapped_column(String(40))
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rationale: Mapped[str] = mapped_column(Text)
    evidence_source: Mapped[str] = mapped_column(String(300), default="")
    user_id: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ScoringConfig(Base):
    __tablename__ = "scoring_configs"
    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="default")  # default | scenario
    portfolio_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    weights: Mapped[dict] = mapped_column(JSON)
    thresholds: Mapped[dict] = mapped_column(JSON)
    gates: Mapped[dict] = mapped_column(JSON)
    cost_assumptions: Mapped[dict] = mapped_column(JSON)
    budget: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(40), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ScoreRun(Base):
    __tablename__ = "score_runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    config_id: Mapped[str] = mapped_column(String(60))
    config_snapshot: Mapped[dict] = mapped_column(JSON)
    scoring_version: Mapped[str] = mapped_column(String(40))
    data_snapshot_hash: Mapped[str] = mapped_column(String(64))
    as_of_date: Mapped[date] = mapped_column(Date)
    run_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(40), default="system")


class PatentScore(Base):
    __tablename__ = "patent_scores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    score_run_id: Mapped[str] = mapped_column(ForeignKey("score_runs.id"), index=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    dimension_scores: Mapped[dict] = mapped_column(JSON)
    strategic_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    data_coverage: Mapped[float] = mapped_column(Float)
    evidence_confidence: Mapped[float] = mapped_column(Float)
    recommendation: Mapped[str] = mapped_column(String(60))
    gate_status: Mapped[str] = mapped_column(String(10))
    gate_reasons: Mapped[list] = mapped_column(JSON, default=list)
    explanation: Mapped[dict] = mapped_column(JSON, default=dict)
    cost: Mapped[dict] = mapped_column(JSON, default=dict)


class ReviewBatch(Base):
    __tablename__ = "review_batches"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    portfolio_id: Mapped[str] = mapped_column(ForeignKey("portfolios.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    asset_ids: Mapped[list] = mapped_column(JSON, default=list)
    assignee_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ReviewDecision(Base):
    __tablename__ = "review_decisions"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    patent_asset_id: Mapped[str] = mapped_column(ForeignKey("patent_assets.id"), index=True)
    score_run_id: Mapped[str] = mapped_column(String(40))
    reviewer_id: Mapped[str] = mapped_column(String(40))
    decision: Mapped[str] = mapped_column(String(40))
    override_recommendation: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    reason_code: Mapped[str] = mapped_column(String(60))
    notes: Mapped[str] = mapped_column(Text, default="")
    original_recommendation: Mapped[str] = mapped_column(String(60), default="")
    original_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    freshness_check: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(40), index=True)
    actor_id: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(80))
    object_type: Mapped[str] = mapped_column(String(60))
    object_id: Mapped[str] = mapped_column(String(80))
    before_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    after_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
