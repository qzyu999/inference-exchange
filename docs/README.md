# Inference Exchange documentation

Inference Exchange is a marketplace for private AI inference. Local providers serve models. Consumers send OpenAI-compatible requests. The coordinator selects a provider for each request.

## How to use these documents

The documents have a fixed order of authority:

1. **[Principles](principles.md)**: The base rules. They do not change often.
2. **[Requirements](requirements/README.md)**: Rules that you can test. Each one comes from a principle.
3. **Code**: An implementation of the requirements.

If the code and a requirement disagree, the code is wrong, or the requirement must change first. The documents in [Archive](archive/README.md) are background only.

## Sections

| Section | Contents |
|---|---|
| [Principles](principles.md) | The base rules of the system |
| [Requirements](requirements/README.md) | Testable rules for each area |
| [Architecture](architecture.md) | The system as it is now |
| [Decisions](decisions/README.md) | Why the project chose each option |
| [Status](status.md) | What works and the known limits |
| [Getting started](guides/getting-started.md) | Run the system on your computer or a server |
| [Security](security/threat-model.md) | Threat model and protocol |
| [Archive](archive/README.md) | Earlier design notes (not normative) |

## Writing rules

Write these documents in ASD-STE100 Simplified Technical English:

- One instruction in each sentence.
- Use the active voice.
- Keep sentences short: 20 words or fewer for instructions, 25 for descriptions.
- Use one word for one meaning. For example, always say "provider", not "node" or "server".
