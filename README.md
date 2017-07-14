# xmr-node-proxy


Setup Instructions
==================

Based on a clean Ubuntu 16.04 LTS minimal install

Deployment via Installer
------------------------

1. Add your user to `/etc/sudoers`, this must be done so the script can sudo up and do it's job.  We suggest passwordless sudo.  Suggested line: `<USER> ALL=(ALL) NOPASSWD:ALL`.  Our sample builds use: `nodeproxy ALL=(ALL) NOPASSWD:ALL`
2. Run the [deploy script](https://raw.githubusercontent.com/Snipa22/xmr-node-proxy/master/install.sh) as a **NON-ROOT USER**.  This is very important!  This script will install the proxy to whatever user it's running under!

```bash
curl -L https://raw.githubusercontent.com/Snipa22/xmr-node-proxy/master/install.sh | bash
```

3. Once it's complete, copy `example_config.json` to `config.json` and edit as desired.
4. Run: source ~/.bashrc  This will activate NVM and get things working for the following pm2 steps.
8. Once you're happy with the settings, go ahead and start all the proxy daemon, commands follow.

```shell
cd ~/xmr-node-proxy/
pm2 start proxy.js --name=proxy --log-date-format="YYYY-MM-DD HH:mm Z"
pm2 save
```
