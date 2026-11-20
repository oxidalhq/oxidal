# Changelog

## [0.2.0](https://github.com/oxidalhq/oxidal/compare/os-v0.1.0...os-v0.2.0) (2026-11-20)


### Features

* add appliance image profiles ([3d26246](https://github.com/oxidalhq/oxidal/commit/3d26246fa8bc782576c0d1c0e88bd3ec5ff3b362))
* add scoped development deploys ([e355056](https://github.com/oxidalhq/oxidal/commit/e355056a0ef7dbd401a887a36c74498418db5963))
* add serial factory topologies ([9499491](https://github.com/oxidalhq/oxidal/commit/949949188a786981fcb201c229e8298d946294a7))
* **deploy:** install Oxidal's own effect bundles with deploy:local lv2 ([9a3862b](https://github.com/oxidalhq/oxidal/commit/9a3862b96dbbc3528a517208cdffb8c391d0638c))
* expand factory sounds and seed private development libraries ([d6cf6ab](https://github.com/oxidalhq/oxidal/commit/d6cf6ab1901303735b689619343249fad4e9be40))
* manage qualified effect packs ([f9e2ba4](https://github.com/oxidalhq/oxidal/commit/f9e2ba44ee2fba56753fcf9d6d64f1d67917732b))
* **media:** add the session media store with resumable chunked uploads ([67e54d1](https://github.com/oxidalhq/oxidal/commit/67e54d17377c3e4d80d2f90b07467e238d21496b))
* **moment:** add the Oxidal Moment micro-looper and texture effect ([384ea26](https://github.com/oxidalhq/oxidal/commit/384ea262ce346e0b61fbe632a5743ead0b896b91))
* **native:** add the Oxidal Swell LV2 effect ([2adadeb](https://github.com/oxidalhq/oxidal/commit/2adadeb00a1360f46ce96fd9bd987836b538eecf))
* **os:** ship the image without third-party effect packs ([9333cac](https://github.com/oxidalhq/oxidal/commit/9333cac20ae881cce60ac433b3c63bfa8e2c5c10))
* **scenes:** save scenes with effect settings as scenes version 2 and name settings by label ([52fe280](https://github.com/oxidalhq/oxidal/commit/52fe280656b0bd0edb7c6ca144cc2926d278e99b))
* schedule next-boot storage lock ([1e6e144](https://github.com/oxidalhq/oxidal/commit/1e6e144b7ba6cddd6b217861db6d266f45f7f492))
* separate writable appliance data ([a8b55ed](https://github.com/oxidalhq/oxidal/commit/a8b55ed26c5357110fe3f4e317f36751b237abb0))
* **web:** add genre, engine and complexity metadata to recipes ([113d1cb](https://github.com/oxidalhq/oxidal/commit/113d1cb6dde182111bcf92998790247177a2833d))


### Bug Fixes

* allow apt privilege drop ([e3f6814](https://github.com/oxidalhq/oxidal/commit/e3f68141141e6adacf06cd87a2dbb2f4557a1710))
* enforce storage modes and seed factory sounds on boot ([e931d44](https://github.com/oxidalhq/oxidal/commit/e931d447e63c21a744684ba25072751850d7c081))
* include factory effects in appliance images ([ba97022](https://github.com/oxidalhq/oxidal/commit/ba97022ea552415b126d817b92d3b0c3266746f4))
* make console login branding readable ([a08893e](https://github.com/oxidalhq/oxidal/commit/a08893ec6d86d9834a9e9e32951e796cb453fb99))
* preserve deployed ui access ([a274a1f](https://github.com/oxidalhq/oxidal/commit/a274a1f8d3e0f90079c1c7b3ff1b9dabd6434b65))
* read data label from filesystem ([e2d6ef2](https://github.com/oxidalhq/oxidal/commit/e2d6ef2d6b3db3adb6d81f1c52e0b53887ac8154))
* run audio workers at realtime priority with locked memory ([8e94e02](https://github.com/oxidalhq/oxidal/commit/8e94e02198e7c47c7c846bae6452406cd76f2bc8))


### Performance Improvements

* parallelize prepared rigs and retain deadline evidence ([201aa96](https://github.com/oxidalhq/oxidal/commit/201aa96f5d49fbe95d886da948600453045d10d8))
