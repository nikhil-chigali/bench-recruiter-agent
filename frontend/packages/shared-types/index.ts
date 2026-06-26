// Public surface of the generated backend contract. Regenerate `openapi.d.ts` with
// `pnpm gen:types`. Add friendly aliases here as consumers need them (see Chunk 2.5+).
export type * from './openapi'

import type { components } from './openapi'

/** Backend `GET /candidates` card (generated). */
export type CandidateCard = components['schemas']['CandidateCard']

/** Backend `GET /members` row (generated). */
export type Member = components['schemas']['MemberOut']
/** Backend `GET /invitations` row (generated). */
export type Invitation = components['schemas']['InvitationOut']
/** Backend `POST /invitations` response — invitation plus its accept URL (generated). */
export type InvitationCreated = components['schemas']['InvitationCreatedOut']
/** Backend `GET /invitations/lookup` preview (generated). */
export type InvitationPreview = components['schemas']['InvitationPreviewOut']
