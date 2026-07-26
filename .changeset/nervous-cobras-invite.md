---
"luojiahai-skills": patch
---

Fix the `preparing-tax-return` frontmatter so the skill installs.

The `description` was an unquoted YAML scalar containing `myTax:` — a colon followed by a space, which YAML reads as the start of a nested mapping. Installers that parse the frontmatter strictly rejected the file ("Nested mappings are not allowed in compact mappings") and skipped the skill, so a fresh install of the plugin found no skills at all. The description is now quoted.
