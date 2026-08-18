'use strict'

const { version: PACKAGE_VERSION } = require('../package.json')

const USER_AGENT = `signalk-storm-intelligence/${PACKAGE_VERSION}`

module.exports = { PACKAGE_VERSION, USER_AGENT }
