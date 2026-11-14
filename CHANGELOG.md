# Changelog

## 1.2.0

### Changed

- Runs in its own process on Termix 26.11.2 and later, with no access to the server beyond what Termix allows it
- Termix reads the hosts file and the `{ env }` and `{ file }` secrets it points at for the plugin. Secrets need the new Read secrets the server holds access, which an admin approves with the update. Termix's own keys and data folder can't be used as secrets
- The hosts file must sit outside Termix's data folder

## 1.1.0

### Added

- Reload the hosts file through Termix actions and see whether it applied as a status tile
- An alert to admins when the hosts file cannot be read or some hosts are not applied, with a setting to turn it off

### Changed

- Needs Termix 26.11.1 or newer

## 1.0.0

### Added

- Load hosts, folders and sharing from the YAML or JSON file named by TERMIX_HOSTS_CONFIG
- Hosts from the file are read only in Termix and keep their id across reloads
- Secrets from env vars, files or saved credentials by name
- Per host plugin switches and settings
- Reload when the file changes or from the admin settings, with every problem listed
- Strict mode that blocks adding hosts by hand
