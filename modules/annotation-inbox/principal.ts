/**
 * Who a request is, in the one shape the SKAILE packages share.
 *
 * Declared per package rather than imported: the three packages never depend
 * on each other, and the types are structurally identical, so a host that
 * hands the same object to several of them type-checks without a shared
 * runtime package between them.
 */

/** A person at a browser. `roles` is the host's vocabulary; this package reads none of it. */
export interface HumanPrincipal {
  kind: 'human'
  id: string
  name?: string
  roles?: string[]
}

/** A process acting for a person — a coding agent holding the bearer token. */
export interface AgentPrincipal {
  kind: 'agent'
  id: string
  projectId?: string
  runId?: string
  label?: string | null
}

export type Principal = HumanPrincipal | AgentPrincipal

/**
 * A dev server is somebody's own machine: whoever reaches it is the reviewer,
 * and a developer annotating their own app must not have to configure a token.
 */
export const DEV_PRINCIPAL: HumanPrincipal = { kind: 'human', id: 'dev', roles: ['reviewer'] }

/**
 * What the `annotation-inbox:authorize` hook's `allowed = true` means when the
 * host names nobody: a reviewer, which is what the inbox called every such
 * caller before principals existed.
 */
export const ANONYMOUS_REVIEWER: HumanPrincipal = { kind: 'human', id: 'reviewer', roles: ['reviewer'] }

/**
 * The agent a matching bearer token identifies. There is one shared secret,
 * so there is one agent id; `label` is the caller's own say-so
 * (`x-agent-label`) and only ever decorates, never authorises.
 */
export function tokenAgent(label?: string | null): AgentPrincipal {
  return { kind: 'agent', id: 'token', label: label ?? null }
}

/**
 * What a resolution records as `resolvedBy`: an agent is `agent`, a person is
 * the name the host gave them, else their id.
 */
export function principalLabel(principal: Principal): string {
  return principal.kind === 'agent' ? 'agent' : (principal.name ?? principal.id)
}
