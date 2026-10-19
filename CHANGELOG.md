# Changelog

## 1.0.0

### Added

- Load hosts, folders and sharing from the YAML or JSON file named by TERMIX_HOSTS_CONFIG
- Hosts from the file are read only in Termix and keep their id across reloads
- Secrets from env vars, files or saved credentials by name
- Per host plugin switches and settings
- Reload when the file changes or from the admin settings, with every problem listed
- Strict mode that blocks adding hosts by hand
