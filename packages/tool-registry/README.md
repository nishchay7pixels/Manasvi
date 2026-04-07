# @manasvi/tool-registry

In-memory tool registry and metadata explorer for governed tool manifests.

Responsibilities:
- validate manifests during registration
- enforce lifecycle status (`enabled`, `disabled`, `deprecated`)
- provide lookup/list/search by tool id and version
- expose policy/action/capability metadata for orchestration and policy binding
