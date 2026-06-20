import uuid

from pydantic import BaseModel


class RecruiterOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    org_id: uuid.UUID
    org_name: str
