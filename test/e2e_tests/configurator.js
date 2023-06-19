/* eslint-disable no-console */
const path = require('path');
const assert = require('assert');
const mockery = require('mockery');
const fs  = require('fs');
const {execSync} = require('child_process');
const {rmDirSync} = require('../../lib/utils');
const {default: Logger} = require('../../lib/logger');
const {default: NightwatchConfigurator} = require('../../lib/NightwatchConfigurator');

const rootDir = path.join(process.cwd(), 'test_output');

function mockLogger(consoleOutput) {
  Logger.error = function(...msgs) {
    consoleOutput.push(...msgs);
  };

  Logger.info = function(...msgs) {
    consoleOutput.push(...msgs);
  };

  Logger.warn = function(...msgs) {
    consoleOutput.push(...msgs);
  };
}


describe('e2e tests for configurator', () => {
  beforeEach(function() {
    rmDirSync(rootDir);

    mockery.enable({useCleanCache: true, warnOnReplace: false, warnOnUnregistered: false});

    if (!fs.existsSync(path.join(rootDir, 'package.json'))) {
      if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(rootDir, {recursive: true});
      }
      execSync('npm init -y', {
        stdio: 'pipe',
        cwd: rootDir
      });
    }
  });

  afterEach(function() {
    mockery.deregisterAll();
    mockery.resetCache();
    mockery.disable();
  });

  it('test add help text', async () => {
    const consoleOutput = [];
    let oldConsole = console.log;
    console.log = function mockLog(...args) {
      consoleOutput.push(args);
    };

    const configurator = new NightwatchConfigurator({add: 'foo'}, rootDir);
    await configurator.run();

    console.log = oldConsole;
    assert.ok(consoleOutput.length > 0);
    assert.ok(consoleOutput[0][0].startsWith('\n    Invalid argument passed to [36m--add[39m, available options are:'));
  });
});