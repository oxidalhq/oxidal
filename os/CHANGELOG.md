# Changelog

## [0.2.0](https://github.com/oxidalhq/oxidal/compare/os-v0.1.0...os-v0.2.0) (2026-11-10)


### Features

* add appliance image profiles ([3d26246](https://github.com/oxidalhq/oxidal/commit/3d26246fa8bc782576c0d1c0e88bd3ec5ff3b362))
* add branded hotspot welcome and discovery ([3de9c03](https://github.com/oxidalhq/oxidal/commit/3de9c03076ddd3aba1cc11f8d07314903f7fbc0c))
* add persistent web terminal services ([4bcd606](https://github.com/oxidalhq/oxidal/commit/4bcd60692caab982ac7354ebf4c2f132b5c5011e))
* add scoped development deploys ([e355056](https://github.com/oxidalhq/oxidal/commit/e355056a0ef7dbd401a887a36c74498418db5963))
* add serial factory topologies ([9499491](https://github.com/oxidalhq/oxidal/commit/949949188a786981fcb201c229e8298d946294a7))
* **audio:** add Linux ALSA device inspection ([c7983a8](https://github.com/oxidalhq/oxidal/commit/c7983a8ef866dc2c07f565df8abc7113063c30c6))
* **audio:** keep authoring available across playback restarts ([50a32b7](https://github.com/oxidalhq/oxidal/commit/50a32b75a2eaf4377eafc324af79889c65bc6427))
* **debug:** add an isolated web command console ([85d106d](https://github.com/oxidalhq/oxidal/commit/85d106d307c809040a82b246baec6d65a3e0c3d9))
* **device:** add recoverable web network configuration ([006107f](https://github.com/oxidalhq/oxidal/commit/006107f2c76301552fef638ae0c2d54051131893))
* **device:** add recoverable wireless country and channel settings ([e1bb510](https://github.com/oxidalhq/oxidal/commit/e1bb510b051fc7dcd13c583eca5037466636f878))
* display preset artwork with durable offline caching ([5162e58](https://github.com/oxidalhq/oxidal/commit/5162e585f2685e2e55986bb0fae247f283b9da16))
* expand factory sounds and seed private development libraries ([d6cf6ab](https://github.com/oxidalhq/oxidal/commit/d6cf6ab1901303735b689619343249fad4e9be40))
* manage qualified effect packs ([f9e2ba4](https://github.com/oxidalhq/oxidal/commit/f9e2ba44ee2fba56753fcf9d6d64f1d67917732b))
* **os:** add boot branding and private development preset seeding ([ceb432d](https://github.com/oxidalhq/oxidal/commit/ceb432d2cee1219204ce74816e8d16a6d68030b4))
* **os:** assemble authenticated headless prototype images ([fa503a9](https://github.com/oxidalhq/oxidal/commit/fa503a9f26e97a62b29cb5f17bd3be7fd63a1e0f))
* recover confirmed audio sessions after daemon restart ([66bfcc9](https://github.com/oxidalhq/oxidal/commit/66bfcc9fffef1b25e88c167a5810162d8caebe23))
* save verified sounding copies without stopping audio ([28372cd](https://github.com/oxidalhq/oxidal/commit/28372cd2cf8b8c2bde3f2473eef4951c23c79973))
* schedule next-boot storage lock ([1e6e144](https://github.com/oxidalhq/oxidal/commit/1e6e144b7ba6cddd6b217861db6d266f45f7f492))
* separate writable appliance data ([a8b55ed](https://github.com/oxidalhq/oxidal/commit/a8b55ed26c5357110fe3f4e317f36751b237abb0))
* toggle parallel NAM branches from touch and MIDI ([b596921](https://github.com/oxidalhq/oxidal/commit/b596921914ce025994ccf60eabe14be42a0d1a08))


### Bug Fixes

* allow apt privilege drop ([e3f6814](https://github.com/oxidalhq/oxidal/commit/e3f68141141e6adacf06cd87a2dbb2f4557a1710))
* enforce storage modes and seed factory sounds on boot ([e931d44](https://github.com/oxidalhq/oxidal/commit/e931d447e63c21a744684ba25072751850d7c081))
* include factory effects in appliance images ([ba97022](https://github.com/oxidalhq/oxidal/commit/ba97022ea552415b126d817b92d3b0c3266746f4))
* make console login branding readable ([a08893e](https://github.com/oxidalhq/oxidal/commit/a08893ec6d86d9834a9e9e32951e796cb453fb99))
* **os:** enable Wi-Fi in appliance network state ([6d88076](https://github.com/oxidalhq/oxidal/commit/6d88076c529775ca48c5d159adaaf047d43b932e))
* **os:** install dynamic user identity support ([263010a](https://github.com/oxidalhq/oxidal/commit/263010a7a41df507b85bc6c667b1c202875342e2))
* **os:** mount firmware partition during image customization ([4e21c81](https://github.com/oxidalhq/oxidal/commit/4e21c81442c9dc08fa766719c4110e40755f1a46))
* **os:** preserve recovery login timeout in new images ([37e2c7e](https://github.com/oxidalhq/oxidal/commit/37e2c7e77826af2645cc86ad5340749342db7ac1))
* **os:** resolve both image filesystems by UUID ([b032765](https://github.com/oxidalhq/oxidal/commit/b0327652f911e9cf32bdee44b1ba2b373daa67ea))
* **os:** restrict access to personalized image files ([3d4832c](https://github.com/oxidalhq/oxidal/commit/3d4832c8505f0501dada4a6674175a60b38a10a2))
* preserve deployed ui access ([a274a1f](https://github.com/oxidalhq/oxidal/commit/a274a1f8d3e0f90079c1c7b3ff1b9dabd6434b65))
* read data label from filesystem ([e2d6ef2](https://github.com/oxidalhq/oxidal/commit/e2d6ef2d6b3db3adb6d81f1c52e0b53887ac8154))
* run audio workers at realtime priority with locked memory ([8e94e02](https://github.com/oxidalhq/oxidal/commit/8e94e02198e7c47c7c846bae6452406cd76f2bc8))
* ship the mixed rig worker in appliance bundles ([111546c](https://github.com/oxidalhq/oxidal/commit/111546cd7c32ee3faa0676ec94c59bb07580380c))


### Performance Improvements

* parallelize prepared rigs and retain deadline evidence ([201aa96](https://github.com/oxidalhq/oxidal/commit/201aa96f5d49fbe95d886da948600453045d10d8))
