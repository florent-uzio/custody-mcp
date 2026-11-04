# Custody MCP

An MCP server that lets a person read from and act on a Ripple Custody instance, as their own Custody user, from an AI client.

## Language

**Environment**:
A named Ripple Custody instance together with the credentials of one Custody user on it (auth URL, API URL, keypair).
_Avoid_: Profile, instance, network, config

**Key reference**:
A pointer to where an Environment's private key is stored (Keychain entry, file, environment variable), never the key itself.
_Avoid_: Secret, key path

**Access level**:
What an Environment permits through this server: `read`, `propose` (read + Propose), or `approve` (propose + Approve/Reject).
_Avoid_: Permission, role, mode

**Default domain**:
The Custody domain an Environment acts in when a call does not name one.
_Avoid_: Tenant, organisation

**Intent**:
A signed proposal to change state in Custody, which takes effect only once the domain's policies are satisfied by approvals.
_Avoid_: Transaction, order, request

**Propose**:
Submit a new Intent to Custody on behalf of the Environment's user.
_Avoid_: Submit, send, create

**Approve** / **Reject**:
The Environment's user casting their decision on a pending Intent.
_Avoid_: Sign, accept, decline

**Pending approval**:
An Intent still awaiting a decision from the Environment's user.
_Avoid_: Open request, todo

**Explorer link**:
A URL to the XRPL explorer page for a transaction or address on one of a Custody instance's XRPL ledgers.
_Avoid_: Network URL, explorer URL

**Dry run**:
Custody's evaluation of an Intent without proposing it, used to catch errors before a Propose.
_Avoid_: Simulation, validation, preview
