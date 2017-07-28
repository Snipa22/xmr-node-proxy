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
You can check the status of your proxy by either issuing

```
pm2 logs proxy
```

or using the pm2 monitor

```
pm2 monit
```

Known Issues
============
VM's with 512Mb of ram or less will need some swap space in order to compile the C extensions for node.  Bignum and the CN libraries can chew some serious memory during compile.

If not running on an Ubuntu 16.04 system, please make sure your kernel is at least 3.2 or higher, as older versions will not work for this.

Many smaller VM's come with Ulimits set very low, we suggest looking into how to tweak the ulimits for your systems higher.  In particular nofile (Number of files open) needs to be raised for high-usage instances.


Performance
===========
The proxy gains a massive boost over a basic pool, by accepting that the majority of the hashes submitted /will/ not be valid, as they do not exceed the required difficulty of the pool.  Due to this the proxy really doesn't bother attempting to validate the hash state and/or value until the difficulty of the share exceeds the difficulty set by the pool.

In testing, we've seen AWS T2.Micro instances taking upwards of 2k connections, with T2.Smalls taking 6k.  The proxy is extremely light weight, and while there are more features on the way, it's our goal to keep the proxy as light weight as possible.

Configuration Guidelines
========================
Please check the [wiki](https://github.com/Snipa22/xmr-node-proxy/wiki/config_review) for information on configuration


Developer Donations
===================
The proxy comes configured for a 1% donation, this is easily toggled inside of it's configuration.  If you'd like to make a one time donation, the addresses are as follows:
* XMR - 44Ldv5GQQhP7K7t3ZBdZjkPA7Kg7dhHwk3ZM3RJqxxrecENSFx27Vq14NAMAd2HBvwEPUVVvydPRLcC69JCZDHLT2X5a4gr
* BTC - 114DGE2jmPb5CP2RGKZn6u6xtccHhZGFmM


Known Working Pools
===================
* [XMRPool.net](https://xmrpool.net)
* [supportXMR.com](https://supportxmr.com)
* [pool.xmr.pt](https://pool.xmr.pt)
* [minemonero.pro](https://minemonero.pro)
* [XMRPool.xyz](https://xmrpool.xyz)
* [ViaXMR.com](https://viaxmr.com)

If you'd like to have your pool added, please make a pull request here, or contact Snipa on IRC!
