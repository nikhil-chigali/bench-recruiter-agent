from enum import StrEnum

# Stored as plain strings in the DB (flexible to evolve); validated at the application
# boundary with these enums rather than via Postgres enum types or CHECK constraints.


class RecruiterRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    RECRUITER = "recruiter"


class WorkAuthorization(StrEnum):
    USC = "USC"
    GC = "GC"
    GC_EAD = "GC_EAD"
    H1B = "H1B"
    OPT = "OPT"
    STEM_OPT = "STEM_OPT"
    L2_EAD = "L2_EAD"
    TN = "TN"
    OTHER = "OTHER"


class EmploymentType(StrEnum):
    CONTRACT_C2C = "CONTRACT_C2C"
    CONTRACT_W2 = "CONTRACT_W2"
    FULL_TIME = "FULL_TIME"


class ApplicationStatus(StrEnum):
    DRAFT = "draft"
    APPLIED = "applied"
    EMAILED = "emailed"
    CLOSED = "closed"


class CandidateStatus(StrEnum):
    ON_BENCH = "on_bench"
    INTERVIEWING = "interviewing"
    PLACED = "placed"


class SubmittedBy(StrEnum):
    AGENT = "agent"
    HUMAN = "human"


class OutreachEmailStatus(StrEnum):
    SENT = "sent"
    NOT_SENT = "not_sent"


class DocumentType(StrEnum):
    RESIDENCY_PROOF = "residency_proof"
    VISA_PROOF = "visa_proof"
    I94 = "i94"
    OTHER = "other"


class InvitationStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REVOKED = "revoked"
