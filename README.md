<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>Hosts Config</h1>

<p>Keep hosts, folders and sharing in a YAML or JSON file. Termix loads them as read only hosts and reloads when the file changes</p>

</div>

<br />

## Overview

Hosts Config lets an admin keep hosts in a file mounted into the container, for example one kept in git. The file is the source of truth: hosts from it are read only in Termix, and only pins and order stay with each user.

Read the [docs](https://docs.termix.site/plugins/hosts-config) to set it up and use it.

<br />

## Features

- SSH, RDP, VNC, Telnet and any plugin protocol from one YAML or JSON file
- Hosts from the file are read only, while pins and order stay with each user
- Secrets from env vars, files or saved credentials, never written in the file
- Shares with users and roles, per host or per folder
- Turn plugin features on or off per host
- Reloads when the file changes, with clear errors when it can't apply
- Strict mode so every host comes from the file

<br />

## Sponsors

For a paid sponsor spot, email [mail@termix.site](mailto:mail@termix.site).

<!-- SPONSORS:START -->

<div align="center">

<br />

<a href="https://www.blacksmith.sh/">
  <img src="https://termix.site/img/sponsors/blacksmith.svg" height="40" alt="Blacksmith" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.cloudflare.com/">
  <img src="https://termix.site/img/sponsors/cloudflare.png" height="40" alt="Cloudflare" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://akamai.com/">
  <img src="https://termix.site/img/sponsors/akamai.svg" height="40" alt="Akamai" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://aws.amazon.com/">
  <img src="https://termix.site/img/sponsors/aws.png" height="40" alt="AWS" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://rackgenius.com/">
  <img src="https://termix.site/img/sponsors/rackgenius.png" height="40" alt="Rack Genius" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://ginernet.com/">
  <img src="https://termix.site/img/sponsors/ginernet.png" height="40" alt="Ginernet" />
</a>
&nbsp;&nbsp;&nbsp;
<a href="https://www.hetzner.com/?mtm_campaign=termix&mtm_medium=referral&mtm_content=sponsoring_link">
  <img src="https://termix.site/img/sponsors/hetzner.png" height="40" alt="Hetzner" />
</a>

</div>

<!-- SPONSORS:END -->

<br />

## Support

Bugs and ideas for Hosts Config go in this repo: [report a bug](https://github.com/Termix-SSH/Plugin-Hosts-Config/issues/new?template=bug_report.yml) or [request a feature](https://github.com/Termix-SSH/Plugin-Hosts-Config/issues/new?template=feature_request.yml). Report an issue on the plugin's page in the Plugins tab fills in your versions for you.

Problems with Termix itself (login, hosts, credentials, sharing, sync) go in the [Termix repo](https://github.com/Termix-SSH/Termix/issues/new/choose). Not sure where it goes? Open it there and it will be moved.

Add as much detail as you can, in English if possible. For questions, join the [Discord](https://discord.gg/jVQGdvHDrf) server.

<br />

## License

Apache License 2.0. See [LICENSE](LICENSE).
