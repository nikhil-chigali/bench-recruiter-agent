import datetime as _dt
import uuid

from pydantic import BaseModel


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str


class MemberOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    status: str
    expires_at: _dt.datetime


class InvitationCreatedOut(InvitationOut):
    accept_url: str


class InvitationPreviewOut(BaseModel):
    org_name: str
    role: str
    email: str
    status: str
    email_matches: bool
