from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from callup.db.session import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# A current-recruiter dependency (Supabase JWT verification + tenant scoping) lands
# with auth in Phase 1; routes will depend on it to enforce per-recruiter tenancy.
