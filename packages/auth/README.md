# @manasvi/auth

Identity and authentication foundation for Manasvi:

- Principal registry interfaces and implementations (`InMemoryPrincipalRegistry`, `JsonFilePrincipalRegistry`)
- Short-lived internal token issuance and validation (`InternalTokenService`)
- HTTP principal resolution (`PrincipalResolver`)
- Event principal-context resolution helpers for actor/caller/origin attribution
