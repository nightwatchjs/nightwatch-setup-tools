const assert = require('assert');
const mockery = require('mockery');
const fs = require('node:fs');
const path = require('path');
const {execSync} = require('child_process');
const {rmDirSync} = require('../../lib/utils');
const nock = require('nock');

const rootDir = path.join(process.cwd(), 'test_output');

function mockLogger(consoleOutput) {
  mockery.registerMock(
    './logger',
    class {
      static error(...msgs) {
        consoleOutput.push(...msgs);
      }
      static info(...msgs) {
        consoleOutput.push(...msgs);
      }
      static warn(...msgs) {
        consoleOutput.push(...msgs);
      }
    }
  );
}


describe('e2e tests for init', function() {
  before(function()  {
    if (!nock.isActive()) {
      nock.activate();
    }
  });

  after(function() {
    nock.cleanAll();
    nock.restore();
  });

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

  it('with js-nightwatch-local', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    const answers = {
      testingType: ['e2e'],
      language: 'js',
      runner: 'nightwatch',
      backend: 'local',
      browsers: ['chrome', 'edge', 'safari'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: false
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInitiator = new NightwatchInitiator(rootDir, []);

    nightwatchInitiator.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInitiator.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInitiator.run();

    // Test answers
    if (process.platform === 'darwin') {
      assert.deepStrictEqual(answers.browsers, ['chrome', 'edge', 'safari']);
    } else {
      assert.deepStrictEqual(answers.browsers, ['chrome', 'edge']);
    }
    assert.strictEqual(answers.remoteBrowsers, undefined);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.mobilePlatform, undefined);
    assert.strictEqual(answers.cloudProvider, undefined);
    assert.strictEqual(answers.remoteName, undefined);
    assert.strictEqual(answers.remoteEnv, undefined);
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'chrome');
    assert.strictEqual(answers.testsLocation, 'tests');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');

    // Test otherInfo
    assert.strictEqual(nightwatchInitiator.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInitiator.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInitiator.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInitiator.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInitiator.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInitiator.otherInfo.templatesGenerated, true);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests', 'nightwatch/examples']);
    assert.deepEqual(config.page_objects_path, ['nightwatch/page-objects']);
    assert.deepEqual(config.custom_commands_path, ['nightwatch/custom-commands']);
    assert.deepEqual(config.custom_assertions_path, ['nightwatch/custom-assertions']);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'chrome');
    if (process.platform === 'darwin') {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'safari',
        'chrome',
        'edge'
      ]);
    } else {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'chrome',
        'edge'
      ]);
    }

    // Test Packages and webdrivers installed
    if (process.platform === 'darwin') {
      assert.strictEqual(commandsExecuted.length, 3);
      assert.strictEqual(commandsExecuted[1], 'sudo safaridriver --enable');
      assert.strictEqual(commandsExecuted[2], 'npx nightwatch --version');
    } else {
      assert.strictEqual(commandsExecuted.length, 2);
      assert.strictEqual(commandsExecuted[1], 'npx nightwatch --version');
    }
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 5);
    assert.deepEqual(exampleFiles, ['custom-assertions', 'custom-commands', 'examples',  'page-objects', 'templates']);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    if (process.platform === 'darwin') {assert.strictEqual(output.includes('Enabling safaridriver...'), true)}
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(output.includes('Success! Generated some example files at \'nightwatch\'.'), true);
    assert.strictEqual(output.includes('TEMPLATE TESTS'), true);
    assert.strictEqual(output.includes('Generating template files...'), true);
    assert.strictEqual(output.includes(`Success! Generated some templates files at '${path.join('nightwatch', 'templates')}'.`), true);
    assert.strictEqual(output.includes('✨ SETUP COMPLETE'), true);
    assert.strictEqual(output.includes('💬 Join our Discord community to find answers to your issues or queries.'), true);
    assert.strictEqual(output.includes('RUN EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(
      output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples')}`),
      true
    );
    assert.strictEqual(
      output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples', 'basic', 'ecosia.js')}`),
      true
    );
    assert.strictEqual(output.includes('[Selenium Server]'), false);

    rmDirSync(rootDir);

  });

  it('with js-cucumber-remote', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    const answers = {
      testingType: ['e2e'],
      language: 'js',
      runner: 'cucumber',
      backend: 'remote',
      cloudProvider: 'other',
      browsers: ['chrome', 'edge'],
      testsLocation: 'tests',
      featurePath: path.join('tests', 'features'),
      baseUrl: 'https://nightwatchjs.org',
      allowAnonymousMetrics: false
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, []);

    nightwatchInit.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.cjs');
    nightwatchInit.getConfigDestPath = () => {
      nightwatchInit.otherInfo.usingESM = true;

      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    assert.deepEqual(answers.browsers, undefined);
    assert.deepEqual(answers.remoteBrowsers, ['chrome', 'edge']);
    assert.deepStrictEqual(answers.mobileBrowsers, undefined);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.mobilePlatform, undefined);
    assert.strictEqual(answers.cloudProvider, 'other');
    assert.strictEqual(answers.remoteName, 'remote');
    assert.strictEqual(answers.remoteEnv.username, 'REMOTE_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'REMOTE_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'chrome');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, path.join('tests', 'features', 'nightwatch'));

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, true);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests']);
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.test_runner.type, 'cucumber');
    assert.strictEqual(config.test_settings.default.test_runner.options.feature_path, 'tests/features');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'chrome');
    assert.strictEqual(config.test_settings.remote.selenium.host, '<remote-hostname>');
    assert.strictEqual(config.test_settings.remote.selenium.port, 4444);
    assert.strictEqual(config.test_settings.remote.username, '${REMOTE_USERNAME}');
    assert.strictEqual(config.test_settings.remote.access_key, '${REMOTE_ACCESS_KEY}');
    assert.deepEqual(Object.keys(config.test_settings), ['default', 'remote', 'remote.chrome', 'remote.edge']);

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 3);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install @cucumber/cucumber --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npx nightwatch --version');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 2);
    assert.deepEqual(exampleFiles, ['nightwatch.feature', 'step_definitions']);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing @cucumber/cucumber'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    assert.strictEqual(output.includes('Generating example for CucumberJS...'), true);
    assert.strictEqual(
      output.includes(
        `Success! Generated an example for CucumberJS at "${path.join('tests', 'features', 'nightwatch')}"`
      ),
      true
    );

    assert.strictEqual(output.includes('IMPORTANT'), true);
    assert.strictEqual(output.includes('To run tests on your remote device, please set the host and port property in your nightwatch.conf.cjs file.'), true);
    assert.strictEqual(output.includes('These can be located at:'), true);
    assert.strictEqual(output.includes('Please set the credentials (if any) required to run tests'), true);
    assert.strictEqual(output.includes('- REMOTE_USERNAME'), true);
    assert.strictEqual(output.includes('- REMOTE_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(output.includes('To run your tests with CucumberJS, simply run:'), true);
    assert.strictEqual(output.includes('cd test_output\n  npx nightwatch --env remote.chrome'), true);
    assert.strictEqual(output.includes('To run an example test with CucumberJS, run:'), true);
    assert.strictEqual(
      output.includes(`cd test_output\n  npx nightwatch ${path.join('tests', 'features', 'nightwatch')} --env remote.chrome`),
      true
    );
    assert.strictEqual(output.includes('For more details on using CucumberJS with Nightwatch, visit:'), true);
    assert.strictEqual(output.includes('TEMPLATE TESTS'), false);

    rmDirSync(rootDir);

  });

  it('with js-mocha-both-app', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    let appDownloaderCalled = false;
    const origUtils = require('../../lib/utils.js');
    origUtils.downloadWithProgressBar = () => {
      return appDownloaderCalled = true;
    };

    const colorFn = (arg) => arg;
    const mockedColors = {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    };
    mockedColors.gray.italic = colorFn;
    mockery.registerMock('ansi-colors', mockedColors);

    let androidSetupOptions;
    mockery.registerMock('@nightwatch/mobile-helper', {
      AndroidSetup: class {
        constructor(options) {
          androidSetupOptions = options;
        }
        run() {
          return {
            status: true,
            mode: 'real'
          };
        }
      },
      IosSetup: class {
        constructor() {}
        run() {
          return {
            real: false,
            simulator: true
          };
        }
      }
    });

    // Create a folder in the 'tests' folder, to make it non-empty.
    fs.mkdirSync(path.join(rootDir, 'tests', 'sample'), {recursive: true});

    const answers = {
      testingType: ['component', 'app'],
      language: 'js',
      runner: 'mocha',
      backend: 'both',
      cloudProvider: 'browserstack',
      browsers: ['firefox', 'safari'],
      mobilePlatform: 'both',
      uiFramework: 'react',
      testsLocation: 'tests',
      baseUrl: 'https://nightwatchjs.org',
      allowAnonymousMetrics: false
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, []);

    nightwatchInit.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    if (process.platform === 'darwin') {
      assert.deepEqual(answers.browsers, ['firefox', 'safari']);
      assert.strictEqual(answers.mobilePlatform, 'both');
    } else {
      assert.deepEqual(answers.browsers, ['firefox']);
      assert.strictEqual(answers.mobilePlatform, 'android');
    }
    assert.deepEqual(answers.remoteBrowsers, ['firefox', 'safari']);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.cloudProvider, 'browserstack');
    assert.strictEqual(answers.remoteName, 'browserstack');
    assert.strictEqual(answers.remoteEnv.username, 'BROWSERSTACK_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'BROWSERSTACK_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'firefox');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');
    assert.deepStrictEqual(answers.plugins, ['@nightwatch/react']);

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, true);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests', 'nightwatch/examples']);
    assert.deepEqual(config.page_objects_path, ['nightwatch/page-objects']);
    assert.deepEqual(config.custom_commands_path, ['nightwatch/custom-commands']);
    assert.deepEqual(config.custom_assertions_path, ['nightwatch/custom-assertions']);
    assert.deepEqual(config.plugins, ['@nightwatch/react']);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.test_runner.type, 'mocha');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'firefox');
    assert.strictEqual(config.test_settings.browserstack.selenium.host, 'hub.browserstack.com');
    assert.strictEqual(config.test_settings.browserstack.selenium.port, 443);
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].userName, '${BROWSERSTACK_USERNAME}');
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].accessKey, '${BROWSERSTACK_ACCESS_KEY}');
    if (process.platform === 'darwin') {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'safari',
        'firefox',
        'app',
        'app.android.emulator',
        'app.android.real',
        'app.ios.simulator',
        'app.ios.real',
        'browserstack',
        'browserstack.local',
        'browserstack.firefox',
        'browserstack.safari',
        'browserstack.local_firefox'
      ]);
    } else {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'firefox',
        'app',
        'app.android.emulator',
        'app.android.real',
        'browserstack',
        'browserstack.local',
        'browserstack.firefox',
        'browserstack.safari',
        'browserstack.local_firefox'
      ]);
    }

    // Test Packages and webdrivers installed
    if (process.platform === 'darwin') {
      assert.strictEqual(commandsExecuted.length, 8);
      assert.strictEqual(commandsExecuted[4], 'sudo safaridriver --enable');
      assert.strictEqual(commandsExecuted[5], 'npx appium driver install uiautomator2');
      assert.strictEqual(commandsExecuted[6], 'npx appium driver install xcuitest');
    } else {
      assert.strictEqual(commandsExecuted.length, 6);
      assert.strictEqual(commandsExecuted[4], 'npx appium driver install uiautomator2');
    }
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install appium --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npm install @nightwatch/react --save-dev');
    assert.strictEqual(commandsExecuted[3], 'npm install @nightwatch/mobile-helper --save-dev');

    // Test mobile-helper setup
    assert.deepStrictEqual(androidSetupOptions, {browsers: [], appium: true});

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 7);
    assert.deepEqual(exampleFiles, [
      'custom-assertions', 'custom-commands', 'examples',
      'index.jsx', 'page-objects', 'sample-apps', 'templates']);
    assert.strictEqual(appDownloaderCalled, true);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    assert.strictEqual(output.includes('Installing appium driver for Android (uiautomator2)...'), true);
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(output.includes('Success! Generated some example files at \'nightwatch\'.'), true);
    assert.strictEqual(output.includes('Please set the credentials required to run tests on your cloud provider'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_USERNAME'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes('RUN EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples')}`), true);
    assert.strictEqual(
      output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples', 'basic', 'ecosia.js')}`),
      true
    );
    assert.strictEqual(output.includes('[Selenium Server]'), false);
    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(output.includes('To run an example test on Real Android device'), true);
    assert.strictEqual(output.includes('* Make sure your device is connected'), true);
    assert.strictEqual(output.includes('* Make sure required browsers are installed.'), true);
    assert.strictEqual(output.includes('Change directory:\n    cd test_output'), true);
    assert.strictEqual(output.includes('For mobile app tests, run:'), true);
    assert.strictEqual(output.includes(`${path.join('mobile-app-tests', 'wikipedia-android.js')} --env app.android.real`), true);
    assert.strictEqual(output.includes('To run an example test on Android Emulator'), false);

    if (process.platform === 'darwin') {
      assert.strictEqual(output.includes('Installing the following webdrivers:\n- safaridriver'), true);
      assert.strictEqual(output.includes('Installing appium driver for iOS (xcuitest)...'), true);

      assert.strictEqual(output.includes('To run an example test on iOS simulator'), true);
      assert.strictEqual(output.includes('For mobile app tests, run:'), true);
      assert.strictEqual(output.includes('mobile-app-tests/wikipedia-ios.js --env app.ios.simulator'), true);
      assert.strictEqual(output.includes('iOS setup incomplete...'), true);
      assert.strictEqual(output.includes('Please follow the guide above'), true);
      assert.strictEqual(output.includes('re-run the following commands (run cd test_output first):'), true); 
      assert.strictEqual(output.includes('For iOS setup, run:'), true);
      assert.strictEqual(output.includes('For iOS help, run:'), true);
      assert.strictEqual(output.includes('After completing the setup...'), true);
      assert.strictEqual(output.includes('To run an example test on real iOS device'), true);
      assert.strictEqual(output.includes('To run an example test on iOS simulator'), true);
    } else {
      assert.strictEqual(output.includes('To run an example test on iOS simulator'), false);
      assert.strictEqual(output.includes('To run an example test on real iOS device'), false);
      assert.strictEqual(output.includes('iOS setup failed...'), false);
      assert.strictEqual(output.includes('iOS setup incomplete...'), false);
    }

    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS ON CLOUD'), false);

    rmDirSync(rootDir);

  });

  it('with ts-nightwatch-remote-mobile-app', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    let appDownloaderCalled = false;
    const origUtils = require('../../lib/utils.js');
    origUtils.downloadWithProgressBar = () => {
      return appDownloaderCalled = true;
    };

    // Create an empty 'tests' folder in the rootDir.
    fs.mkdirSync(path.join(rootDir, 'tests'), {recursive: true});

    const answers = {
      testingType: ['e2e', 'app'],
      language: 'ts',
      runner: 'nightwatch',
      backend: 'remote',
      cloudProvider: 'saucelabs',
      browsers: ['firefox'],
      remoteBrowsers: ['chrome', 'edge', 'safari'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: false,
      mobile: true
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, []);

    nightwatchInit.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    assert.deepEqual(answers.browsers, undefined);
    assert.deepEqual(answers.remoteBrowsers, ['chrome', 'edge', 'safari']);
    assert.deepStrictEqual(answers.mobileBrowsers, undefined);
    assert.strictEqual(answers.mobileRemote, true);
    assert.strictEqual(answers.mobilePlatform, 'android');
    assert.strictEqual(answers.cloudProvider, 'saucelabs');
    assert.strictEqual(answers.remoteName, 'saucelabs');
    assert.strictEqual(answers.remoteEnv.username, 'SAUCE_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'SAUCE_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'chrome');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, '');
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests', 'nightwatch']);
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'chrome');
    assert.strictEqual(config.test_settings.saucelabs.selenium.host, 'ondemand.saucelabs.com');
    assert.strictEqual(config.test_settings.saucelabs.selenium.port, 443);
    assert.strictEqual(config.test_settings.saucelabs.desiredCapabilities['sauce:options'].username, '${SAUCE_USERNAME}');
    assert.strictEqual(config.test_settings.saucelabs.desiredCapabilities['sauce:options'].accessKey, '${SAUCE_ACCESS_KEY}');
    assert.deepEqual(Object.keys(config.test_settings), [
      'default',
      'saucelabs',
      'saucelabs.chrome',
      'saucelabs.safari'
    ]);

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 6);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install typescript --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npm install @swc/core --save-dev');
    assert.strictEqual(commandsExecuted[3], 'npm install ts-node --save-dev');
    assert.strictEqual(commandsExecuted[4], 'npx tsc --init');
    assert.strictEqual(commandsExecuted[5], 'npx nightwatch --version');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 7);
    assert.deepStrictEqual(exampleFiles, ['duckDuckGo.ts', 'ecosia.ts', 'github.ts', 'google.ts', 'mobile-app-tests', 'sample-apps', 'tsconfig.json']);
    assert.strictEqual(appDownloaderCalled, true);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing typescript'), true);
    assert.strictEqual(output.includes('Installing @swc/core'), true);
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(
      output.includes('Success! Generated some example files at \'nightwatch\'.'),
      true
    );
    assert.strictEqual(output.includes('Generating mobile-app example tests...'), true);
    assert.strictEqual(output.includes('Downloading sample android app...'), true);
    assert.strictEqual(output.includes('Downloading sample ios app...'), false);
    assert.strictEqual(
      output.includes(`Success! Configuration file generated at: "${path.join(rootDir, 'nightwatch.conf.js')}"`),
      true
    );
    // Mobile-helper tool not run for remote
    assert.strictEqual(output.includes('Running Android Setup...'), false);
    assert.strictEqual(output.includes('Running iOS Setup...'), false);
    assert.strictEqual(output.includes('SETUP COMPLETE'), true);
    assert.strictEqual(output.includes('TEMPLATE TESTS'), false); // templates only copied for js

    // Web testing instructions (remote)
    assert.strictEqual(output.includes('Please set the credentials required to run tests on your cloud provider'), true);
    assert.strictEqual(output.includes('- SAUCE_USERNAME'), true);
    assert.strictEqual(output.includes('- SAUCE_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes('RUN EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch')} --env saucelabs.chrome`), true);
    assert.strictEqual(
      output.includes(
        `cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'github.ts')} --env saucelabs.chrome`
      ),
      true
    );

    // Mobile web/app testing instructions
    // only printed if no other instructions are printed
    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS'), false);
    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS ON CLOUD'), false);

    rmDirSync(rootDir);

  });

  it('with ts-mocha-both-browserstack-mobile and non-default config', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: false};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    const mockedColors = {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    };
    mockedColors.gray.italic = colorFn;
    mockery.registerMock('ansi-colors', mockedColors);

    let androidSetupOptionsPassed;
    let androidSetupRootDirPassed;
    mockery.registerMock('@nightwatch/mobile-helper', {
      AndroidSetup: class {
        constructor(options, rootDir) {
          androidSetupOptionsPassed = options;
          androidSetupRootDirPassed = rootDir;
        }
        run() {
          return {
            status: true,
            mode: 'both'
          };
        }
      },
      IosSetup: class {
        constructor() {}
        run() {
          return {
            real: true,
            simulator: true
          };
        }
      }
    });

    // Create a non-empty 'tests' folder as well as a non-empty
    // 'nightwatch' folder in the rootDir.
    fs.mkdirSync(path.join(rootDir, 'tests', 'sample'), {recursive: true});
    fs.mkdirSync(path.join(rootDir, 'nightwatch', 'sample'), {recursive: true});

    const answers = {
      testingType: ['e2e'],
      language: 'ts',
      runner: 'mocha',
      backend: 'both',
      cloudProvider: 'browserstack',
      browsers: ['firefox', 'safari'],
      remoteBrowsers: ['chrome'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: false,
      mobile: true
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, []);

    nightwatchInit.askQuestions = function() {
      return answers;
    };

    const configFileName = 'new-config.conf.js';
    const configPath = path.join(rootDir, configFileName);
    nightwatchInit.getConfigDestPath = function() {
      nightwatchInit.otherInfo.nonDefaultConfigName = configFileName;

      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    let browsers;
    if (process.platform === 'darwin') {
      browsers = ['firefox', 'safari'];
      assert.strictEqual(answers.mobilePlatform, 'both');
    } else {
      browsers = ['firefox'];
      assert.strictEqual(answers.mobilePlatform, 'android');
    }
    assert.deepStrictEqual(answers.browsers, browsers);
    assert.deepStrictEqual(answers.mobileBrowsers, browsers);
    assert.deepStrictEqual(answers.remoteBrowsers, ['chrome']);
    assert.strictEqual(answers.mobileRemote, true);
    assert.strictEqual(answers.cloudProvider, 'browserstack');
    assert.strictEqual(answers.remoteName, 'browserstack');
    assert.strictEqual(answers.remoteEnv.username, 'BROWSERSTACK_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'BROWSERSTACK_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'firefox');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');

    // Test info passed
    assert.deepStrictEqual(androidSetupOptionsPassed, {browsers: browsers});
    assert.strictEqual(androidSetupRootDirPassed, rootDir);

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, '');
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, configFileName);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests', 'nightwatch']);
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'firefox');
    assert.strictEqual(config.test_settings.browserstack.selenium.host, 'hub.browserstack.com');
    assert.strictEqual(config.test_settings.browserstack.selenium.port, 443);
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].userName, '${BROWSERSTACK_USERNAME}');
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].accessKey, '${BROWSERSTACK_ACCESS_KEY}');
    if (process.platform === 'darwin') {
      assert.deepStrictEqual(Object.keys(config.test_settings), [
        'default',
        'safari',
        'firefox',
        'android.real.firefox',
        'android.emulator.firefox',
        'ios.real.safari',
        'ios.simulator.safari',
        'browserstack',
        'browserstack.local',
        'browserstack.chrome',
        'browserstack.local_chrome',
        'browserstack.android.chrome',
        'browserstack.ios.safari'
      ]);
    } else {
      assert.deepStrictEqual(Object.keys(config.test_settings), [
        'default',
        'firefox',
        'android.real.firefox',
        'android.emulator.firefox',
        'browserstack',
        'browserstack.local',
        'browserstack.chrome',
        'browserstack.local_chrome',
        'browserstack.android.chrome',
        'browserstack.ios.safari'
      ]);
    }

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 7);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install typescript --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npm install @swc/core --save-dev');
    assert.strictEqual(commandsExecuted[3], 'npm install ts-node --save-dev');
    assert.strictEqual(commandsExecuted[4], 'npm install @nightwatch/mobile-helper --save-dev');
    assert.strictEqual(commandsExecuted[5], 'npx tsc --init');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    // examples not copied
    assert.strictEqual(exampleFiles.length, 2);
    assert.deepEqual(exampleFiles, ['sample', 'tsconfig.json']);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing typescript'), true);
    assert.strictEqual(output.includes('Installing @swc/core'), true);
    assert.strictEqual(output.includes('Installing @nightwatch/mobile-helper'), true);
    if (process.platform === 'darwin') {
      assert.strictEqual(
        output.includes('Please run \'sudo safaridriver --enable\' command to enable safaridriver later.'),
        true
      );
    }
    assert.strictEqual(
      output.includes(`Success! Configuration file generated at: "${path.join(rootDir, configFileName)}"`),
      true
    );
    assert.strictEqual(output.includes('To use this configuration file, run the tests using --config flag.'), true);
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(
      output.includes('Examples already exists at \'nightwatch\'. Skipping...'),
      true
    );
    assert.strictEqual(output.includes('Please set the credentials required to run tests on your cloud provider'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_USERNAME'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch')} --config new-config.conf.js`), true);
    assert.strictEqual(
      output.includes(
        `cd test_output\n  npx nightwatch .${path.sep}${path.join(
          'nightwatch',
          'github.ts'
        )} --config new-config.conf.js`
      ),
      true
    );
    assert.strictEqual(output.includes('[Selenium Server]'), false);

    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(output.includes('To run an example test on Real Android device'), true);
    assert.strictEqual(output.includes('* Make sure your device is connected'), true);
    assert.strictEqual(output.includes('* Make sure required browsers are installed.'), true);
    assert.strictEqual(output.includes('Change directory:\n    cd test_output'), true);
    assert.strictEqual(output.includes('For mobile web tests, run:'), true);
    assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env android.real.firefox'), true);
    assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env android.real.chrome'), false);
    assert.strictEqual(output.includes('To run an example test on Android Emulator'), true);
    assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env android.emulator.firefox'), true);
    assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env android.emulator.chrome'), false);
    if (process.platform === 'darwin') {
      assert.strictEqual(output.includes('To run an example test on real iOS device'), true);
      assert.strictEqual(output.includes('To run an example test on iOS simulator'), true);
      assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env ios.real.safari'), true);
      assert.strictEqual(output.includes('github.ts --config new-config.conf.js --env ios.simulator.safari'), true);
    }

    rmDirSync(rootDir);

  });

  it('with yes and browser flag', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    const answers = require('../../lib/defaults.json');
    mockery.registerMock('./defaults.json', answers);

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {
      'generate-config': false,
      yes: true,
      browser: ['firefox', 'chrome']
    });

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    assert.deepEqual(answers.browsers, ['firefox', 'chrome']);
    assert.deepEqual(answers.remoteBrowsers, ['firefox', 'chrome']);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.mobilePlatform, undefined);
    assert.strictEqual(answers.cloudProvider, 'browserstack');
    assert.strictEqual(answers.remoteName, 'browserstack');
    assert.strictEqual(answers.remoteEnv.username, 'BROWSERSTACK_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'BROWSERSTACK_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, true);
    assert.strictEqual(answers.defaultBrowser, 'firefox');
    assert.strictEqual(answers.testsLocation, 'nightwatch-e2e');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'nightwatch-e2e');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, true);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['nightwatch-e2e', 'nightwatch/examples']);
    assert.deepEqual(config.page_objects_path, ['nightwatch/page-objects']);
    assert.deepEqual(config.custom_commands_path, ['nightwatch/custom-commands']);
    assert.deepEqual(config.custom_assertions_path, ['nightwatch/custom-assertions']);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'http://localhost');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'firefox');
    assert.strictEqual(config.test_settings.browserstack.selenium.host, 'hub.browserstack.com');
    assert.strictEqual(config.test_settings.browserstack.selenium.port, 443);
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].userName, '${BROWSERSTACK_USERNAME}');
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].accessKey, '${BROWSERSTACK_ACCESS_KEY}');
    assert.deepEqual(Object.keys(config.test_settings), [
      'default',
      'firefox',
      'chrome',
      'browserstack',
      'browserstack.local',
      'browserstack.chrome',
      'browserstack.firefox',
      'browserstack.local_chrome',
      'browserstack.local_firefox',
      'selenium_server',
      'selenium.chrome',
      'selenium.firefox'
    ]);

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 4);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install @nightwatch/selenium-server --save-dev');
    assert.strictEqual(commandsExecuted[2], 'java -version');
    assert.strictEqual(commandsExecuted[3], 'npx nightwatch --version');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 5);
    assert.deepEqual(exampleFiles, ['custom-assertions', 'custom-commands', 'examples',  'page-objects', 'templates']);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing @nightwatch/selenium-server'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(output.includes('Success! Generated some example files at \'nightwatch\'.'), true);
    assert.strictEqual(output.includes('Please set the credentials required to run tests on your cloud provider'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_USERNAME'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes('TEMPLATE TESTS'), true);
    assert.strictEqual(output.includes('RUN EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('First, change directory to the root dir of your project:'), false);
    assert.strictEqual(output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples')}`), true);
    assert.strictEqual(
      output.includes(`cd test_output\n  npx nightwatch .${path.sep}${path.join('nightwatch', 'examples', 'basic', 'ecosia.js')}`),
      true
    );
    assert.strictEqual(output.includes('[Selenium Server]'), true);
    assert.strictEqual(output.includes('To run tests on your local selenium-server, use command:'), true);
    assert.strictEqual(output.includes('cd test_output\n  npx nightwatch --env selenium_server'), true);

    rmDirSync(rootDir);
  });

  it('with yes, browser and mobile flag', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    const mockedColors = {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    };
    mockedColors.gray.italic = colorFn;
    mockery.registerMock('ansi-colors', mockedColors);

    mockery.registerMock('@nightwatch/mobile-helper', {
      AndroidSetup: class {
        constructor() {}
        run() {
          return {
            status: false,
            setup: true
          };
        }
      },
      IosSetup: class {
        constructor() {}
        run() {
          return {
            real: true,
            simulator: false
          };
        }
      }
    });

    const answers = require('../../lib/defaultsMobile.json');
    mockery.registerMock('./defaultsMobile.json', answers);

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {
      'generate-config': false,
      yes: true,
      browser: ['firefox', 'chrome', 'safari'],
      mobile: true
    });

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    let mobileBrowsers;
    if (process.platform === 'darwin') {
      mobileBrowsers = ['firefox', 'chrome', 'safari'];
      assert.strictEqual(answers.mobilePlatform, 'both');
    } else {
      mobileBrowsers = ['firefox', 'chrome'];
      assert.strictEqual(answers.mobilePlatform, 'android');
    }
    assert.deepStrictEqual(answers.browsers, []);
    assert.deepStrictEqual(answers.mobileBrowsers, mobileBrowsers);
    assert.deepEqual(answers.remoteBrowsers, []);
    assert.strictEqual(answers.mobileRemote, true);
    assert.strictEqual(answers.cloudProvider, 'browserstack');
    assert.strictEqual(answers.remoteName, 'browserstack');
    assert.strictEqual(answers.remoteEnv.username, 'BROWSERSTACK_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'BROWSERSTACK_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'firefox');
    assert.strictEqual(answers.testsLocation, 'nightwatch-e2e');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'nightwatch-e2e');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, true);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['nightwatch-e2e', 'nightwatch/examples']);
    assert.deepEqual(config.page_objects_path, ['nightwatch/page-objects']);
    assert.deepEqual(config.custom_commands_path, ['nightwatch/custom-commands']);
    assert.deepEqual(config.custom_assertions_path, ['nightwatch/custom-assertions']);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'http://localhost');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'firefox');
    assert.strictEqual(config.test_settings.browserstack.selenium.host, 'hub.browserstack.com');
    assert.strictEqual(config.test_settings.browserstack.selenium.port, 443);
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].userName, '${BROWSERSTACK_USERNAME}');
    assert.strictEqual(config.test_settings.browserstack.desiredCapabilities['bstack:options'].accessKey, '${BROWSERSTACK_ACCESS_KEY}');
    if (process.platform === 'darwin') {
      assert.deepStrictEqual(Object.keys(config.test_settings), [
        'default',
        'android.real.firefox',
        'android.emulator.firefox',
        'android.real.chrome',
        'android.emulator.chrome',
        'ios.real.safari',
        'ios.simulator.safari',
        'browserstack',
        'browserstack.local',
        'browserstack.android.chrome',
        'browserstack.ios.safari'
      ]);
    } else {
      assert.deepStrictEqual(Object.keys(config.test_settings), [
        'default',
        'android.real.firefox',
        'android.emulator.firefox',
        'android.real.chrome',
        'android.emulator.chrome',
        'browserstack',
        'browserstack.local',
        'browserstack.android.chrome',
        'browserstack.ios.safari'
      ]);
    }

    // Test Packages and webdrivers installed
    if (process.platform === 'darwin') {
      assert.strictEqual(commandsExecuted.length, 4);
      assert.strictEqual(commandsExecuted[2], 'sudo safaridriver --enable');
    } else {
      assert.strictEqual(commandsExecuted.length, 3);
    }
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install @nightwatch/mobile-helper --save-dev');

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);
    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 5);
    assert.deepEqual(exampleFiles, ['custom-assertions', 'custom-commands', 'examples',  'page-objects', 'templates']);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing @nightwatch/mobile-helper'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    if (process.platform === 'darwin') {assert.strictEqual(output.includes('Enabling safaridriver...'), true)}
    assert.strictEqual(output.includes('Generating example files...'), true);
    assert.strictEqual(output.includes('Success! Generated some example files at \'nightwatch\'.'), true);
    assert.strictEqual(output.includes('Please set the credentials required to run tests on your cloud provider'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_USERNAME'), true);
    assert.strictEqual(output.includes('- BROWSERSTACK_ACCESS_KEY'), true);
    assert.strictEqual(output.includes('(.env files are also supported)'), true);
    assert.strictEqual(output.includes('TEMPLATE TESTS'), true);

    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('Android setup failed...'), true);
    assert.strictEqual(output.includes('Please go through the setup logs above'), true);
    assert.strictEqual(output.includes('re-run the following commands (run cd test_output first):'), true);
    assert.strictEqual(output.includes('To setup Android, run:'), true);
    assert.strictEqual(output.includes('For Android help, run:'), true);
    assert.strictEqual(output.includes('Once setup is complete...'), true);
    assert.strictEqual(output.includes('To run an example test on Real Android device'), true);
    assert.strictEqual(output.includes('To run an example test on Android Emulator'), true);
    assert.strictEqual(output.includes('For mobile web tests, run:'), true);
    assert.strictEqual(output.includes('For mobile app tests, run:'), false);
    if (process.platform === 'darwin') {
      assert.strictEqual(output.includes('To run an example test on real iOS device'), true);
      assert.strictEqual(output.includes('ecosia.js --env ios.real.safari'), true);
      assert.strictEqual(output.includes('iOS setup incomplete...'), true);
      assert.strictEqual(output.includes('Please follow the guide above'), true);
      assert.strictEqual(output.includes('For iOS setup, run:'), true);
      assert.strictEqual(output.includes('For iOS help, run:'), true);
      assert.strictEqual(output.includes('After completing the setup...'), true);
      assert.strictEqual(output.includes('To run an example test on real iOS device'), true);
      assert.strictEqual(output.includes('To run an example test on iOS simulator'), true);
    }

    rmDirSync(rootDir);
  });

  it('with yes, and native flag', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command) {
        commandsExecuted.push(command);
      }
    });

    let appDownloaderCalled = false;
    const origUtils = require('../../lib/utils.js');
    origUtils.downloadWithProgressBar = () => {
      return appDownloaderCalled = true;
    };

    const colorFn = (arg) => arg;
    const mockedColors = {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    };
    mockedColors.gray.italic = colorFn;
    mockery.registerMock('ansi-colors', mockedColors);

    let androidSetupOptions;
    mockery.registerMock('@nightwatch/mobile-helper', {
      AndroidSetup: class {
        constructor(options) {
          androidSetupOptions = options;
        }
        run() {
          return {
            status: true,
            mode: 'both'
          };
        }
      }
    });

    const answers = require('../../lib/defaultsApp.json');
    mockery.registerMock('./defaultsApp.json', answers);

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {
      'generate-config': false,
      yes: true,
      native: true
    });

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    // Test answers
    assert.strictEqual(answers.backend, 'local');
    assert.deepStrictEqual(answers.browsers, []);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobilePlatform, 'android');
    assert.deepEqual(answers.remoteBrowsers, undefined);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.cloudProvider, undefined);
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, '');
    assert.strictEqual(answers.testsLocation, 'nightwatch');
    assert.strictEqual(answers.addExamples, true);
    assert.strictEqual(answers.examplesLocation, 'nightwatch');
    assert.strictEqual(answers.baseUrl, '');

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, 'nightwatch');
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.nonDefaultConfigName, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['nightwatch/examples']);
    // only set for web testing
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, '');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, '');
    assert.strictEqual(config.test_settings.app.selenium.host, 'localhost');
    assert.strictEqual(config.test_settings.app.selenium.port, 4723);
    assert.strictEqual(config.test_settings.app.selenium.use_appium, true);
    assert.deepStrictEqual(Object.keys(config.test_settings), [
      'default',
      'app',
      'app.android.emulator',
      'app.android.real'
    ]);

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 5);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install appium --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npm install @nightwatch/mobile-helper --save-dev');
    assert.strictEqual(commandsExecuted[3], 'npx appium driver install uiautomator2');
    assert.strictEqual(commandsExecuted[4], 'npx nightwatch --version');

    // Test mobile-helper setup
    assert.deepStrictEqual(androidSetupOptions, {browsers: [], appium: true});

    // Test examples copied
    const examplesPath = path.join(rootDir, answers.examplesLocation);
    assert.strictEqual(fs.existsSync(examplesPath), true);

    const exampleFiles = fs.readdirSync(examplesPath);
    assert.strictEqual(exampleFiles.length, 2);
    assert.deepStrictEqual(exampleFiles, ['examples', 'sample-apps']);
    assert.strictEqual(fs.existsSync(path.join(examplesPath, 'examples', 'mobile-app-tests')), true);
    assert.strictEqual(appDownloaderCalled, true);

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing appium'), true);
    assert.strictEqual(output.includes('Installing @nightwatch/mobile-helper'), true);
    assert.strictEqual(output.includes('Installing appium driver for Android (uiautomator2)...'), true);
    assert.strictEqual(output.includes('Generating mobile-app example tests...'), true);
    assert.strictEqual(output.includes('Downloading sample android app...'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    assert.strictEqual(output.includes('Running Android Setup...'), true);
    assert.strictEqual(output.includes('SETUP COMPLETE'), true);

    assert.strictEqual(output.includes('TEMPLATE TESTS'), false);
    assert.strictEqual(output.includes('RUN EXAMPLE TESTS'), false);

    assert.strictEqual(output.includes('RUN MOBILE EXAMPLE TESTS'), true);
    assert.strictEqual(output.includes('change directory to the root dir'), false);
    assert.strictEqual(output.includes('To run an example test on Real Android device'), true);
    assert.strictEqual(output.includes('* Make sure your device is connected'), true);
    assert.strictEqual(output.includes('* Make sure required browsers are installed.'), true);
    assert.strictEqual(output.includes('Change directory:\n    cd test_output'), true);
    assert.strictEqual(output.includes('For mobile app tests, run:'), true);
    assert.strictEqual(output.includes(`${path.join('mobile-app-tests', 'wikipedia-android.js')} --env app.android.real`), true);
    assert.strictEqual(output.includes('To run an example test on Android Emulator'), true);
    assert.strictEqual(output.includes('For mobile app tests, run:'), true);
    assert.strictEqual(output.includes(`${path.join('mobile-app-tests', 'wikipedia-android.js')} --env app.android.emulator`), true);

    rmDirSync(rootDir);
  });

  it('generate-config with js-nightwatch-local and seleniumServer false', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    const answers = {
      testingType: ['e2e'],
      language: 'js',
      runner: 'nightwatch',
      backend: 'local',
      browsers: ['chrome', 'edge', 'safari'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      seleniumServer: false,
      allowAnonymousMetrics: false
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {'generate-config': true});

    nightwatchInit.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    assert.strictEqual(nightwatchInit.onlyConfig, true);

    // Test answers
    if (process.platform === 'darwin') {
      assert.deepEqual(answers.browsers, ['chrome', 'edge', 'safari']);
    } else {
      assert.deepEqual(answers.browsers, ['chrome', 'edge']);
    }
    assert.strictEqual(answers.remoteBrowsers, undefined);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.mobilePlatform, undefined);
    assert.strictEqual(answers.cloudProvider, undefined);
    assert.strictEqual(answers.remoteName, undefined);
    assert.strictEqual(answers.remoteEnv, undefined);
    assert.strictEqual(answers.seleniumServer, false);
    assert.strictEqual(answers.defaultBrowser, 'chrome');
    assert.strictEqual(answers.addExamples, undefined);
    assert.strictEqual(answers.examplesLocation, undefined);

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests']);
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'chrome');
    if (process.platform === 'darwin') {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'safari',
        'chrome',
        'edge'
      ]);
    } else {
      assert.deepEqual(Object.keys(config.test_settings), [
        'default',
        'chrome',
        'edge'
      ]);
    }

    // Test Packages and webdrivers installed
    if (process.platform === 'darwin') {
      assert.strictEqual(commandsExecuted.length, 2);
      assert.strictEqual(commandsExecuted[1], 'sudo safaridriver --enable');
    } else {
      assert.strictEqual(commandsExecuted.length, 1);
    }
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Success! Configuration file generated at:'), true);
    if (process.platform === 'darwin') {assert.strictEqual(output.includes('Enabling safaridriver...'), true)}

    rmDirSync(rootDir);

  });

  it('generate-config with ts-nightwatch-both', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    mockery.registerMock('inquirer', {
      prompt(questions) {
        if (questions[0].name === 'safaridriver') {
          return {safaridriver: true};
        } else {
          return {};
        }
      }
    });

    const colorFn = (arg) => arg;
    mockery.registerMock('ansi-colors', {
      green: colorFn,
      yellow: colorFn,
      magenta: colorFn,
      cyan: colorFn,
      red: colorFn,
      gray: colorFn
    });

    const answers = {
      testingType: ['e2e'],
      language: 'ts',
      runner: 'nightwatch',
      backend: 'both',
      cloudProvider: 'other',
      browsers: ['firefox'],
      remoteBrowsers: ['chrome', 'edge', 'safari'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: false
    };

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {'generate-config': true});

    nightwatchInit.askQuestions = function() {
      return answers;
    };
    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    assert.strictEqual(nightwatchInit.onlyConfig, true);

    // Test answers
    assert.deepEqual(answers.browsers, ['firefox']);
    assert.deepEqual(answers.remoteBrowsers, ['chrome', 'edge', 'safari']);
    assert.deepStrictEqual(answers.mobileBrowsers, []);
    assert.strictEqual(answers.mobileRemote, undefined);
    assert.strictEqual(answers.mobilePlatform, undefined);
    assert.strictEqual(answers.cloudProvider, 'other');
    assert.strictEqual(answers.remoteName, 'remote');
    assert.strictEqual(answers.remoteEnv.username, 'REMOTE_USERNAME');
    assert.strictEqual(answers.remoteEnv.access_key, 'REMOTE_ACCESS_KEY');
    assert.strictEqual(answers.seleniumServer, undefined);
    assert.strictEqual(answers.defaultBrowser, 'firefox');
    assert.strictEqual(answers.addExamples, undefined);
    assert.strictEqual(answers.examplesLocation, undefined);

    // Test otherInfo
    assert.strictEqual(nightwatchInit.otherInfo.tsOutDir, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.testsJsSrc, 'tests');
    assert.strictEqual(nightwatchInit.otherInfo.examplesJsSrc, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.cucumberExamplesAdded, undefined);
    assert.strictEqual(nightwatchInit.otherInfo.templatesGenerated, undefined);

    // Test generated config
    assert.strictEqual(fs.existsSync(configPath), true);
    const config = require(configPath);
    assert.deepEqual(config.src_folders, ['tests']);
    assert.deepEqual(config.page_objects_path, []);
    assert.deepEqual(config.custom_commands_path, []);
    assert.deepEqual(config.custom_assertions_path, []);
    assert.deepEqual(config.plugins, []);
    assert.strictEqual(config.test_settings.default.launch_url, 'https://nightwatchjs.org');
    assert.strictEqual(config.test_settings.default.desiredCapabilities.browserName, 'firefox');
    assert.strictEqual(config.test_settings.remote.selenium.host, '<remote-hostname>');
    assert.strictEqual(config.test_settings.remote.selenium.port, 4444);
    assert.strictEqual(config.test_settings.remote.username, '${REMOTE_USERNAME}');
    assert.strictEqual(config.test_settings.remote.access_key, '${REMOTE_ACCESS_KEY}');
    assert.deepEqual(Object.keys(config.test_settings), [
      'default',
      'firefox',
      'remote',
      'remote.chrome',
      'remote.safari',
      'remote.edge'
    ]);

    // Test Packages and webdrivers installed
    assert.strictEqual(commandsExecuted.length, 4);
    assert.strictEqual(commandsExecuted[0], 'npm install nightwatch --save-dev');
    assert.strictEqual(commandsExecuted[1], 'npm install typescript --save-dev');
    assert.strictEqual(commandsExecuted[2], 'npm install @swc/core --save-dev');
    assert.strictEqual(commandsExecuted[3], 'npm install ts-node --save-dev');

    // Test console output
    const output = consoleOutput.toString();
    assert.strictEqual(output.includes('Installing nightwatch'), true);
    assert.strictEqual(output.includes('Installing typescript'), true);
    assert.strictEqual(output.includes('Installing @swc/core'), true);
    assert.strictEqual(
      output.includes(`Success! Configuration file generated at: "${path.join(rootDir, 'nightwatch.conf.js')}"`),
      true
    );

    rmDirSync(rootDir);
  });

  it('make sure we send analytics data if allowAnalytics is set to true', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    const answers = {
      testingType: ['e2e'],
      language: 'ts',
      runner: 'nightwatch',
      backend: 'both',
      cloudProvider: 'other',
      browsers: ['firefox'],
      remoteBrowsers: ['chrome'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: true,
      mobile: true,
      mobilePlatform: 'iOS',
      uiFramework: 'react'
    };

    const scope = nock('https://www.google-analytics.com')
      .post('/mp/collect?api_secret=XuPojOTwQ6yTO758EV4hBg&measurement_id=G-DEKPKZSLXS')
      .reply(204, (uri, requestBody) => {
        assert.notEqual(requestBody.client_id, '');
        assert.notEqual(requestBody.client_id, undefined);
        assert.strictEqual(typeof requestBody.client_id, 'string');
        assert.deepEqual(requestBody.events, {
          'name': 'nw_install',
          'params': {
            'browsers': 'firefox',
            'cloud_provider': 'other',
            'is_mobile': true,
            'language': 'ts',
            'mobile_platform': 'iOS',
            'runner': 'nightwatch',
            'testing_type': 'e2e',
            'ui_framework': 'react'
          }
        });
        assert.strictEqual(requestBody.non_personalized_ads, true);

        return {
          status: 0,
          state: 'success',
          value: []
        };
      });

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {'generate-config': true});

    nightwatchInit.askQuestions = function() {
      return answers;
    };

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    new Promise(resolve => {
      setTimeout(function() {
        assert.ok(scope.isDone());
        resolve();
      }, 0);

      rmDirSync(rootDir);
    });
  });

  it('make sure there are now errors even if analytics request fails', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    const answers = {
      testingType: ['e2e'],
      language: 'ts',
      runner: 'nightwatch',
      backend: 'both',
      cloudProvider: 'other',
      browsers: ['firefox'],
      remoteBrowsers: ['chrome'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: true
    };

    const scope = nock('https://www.google-analytics.com')
      .post('/mp/collect?api_secret=XuPojOTwQ6yTO758EV4hBg&measurement_id=G-DEKPKZSLXS')
      .replyWithError({
        code: 'ECONNREFUSED',
        errno: 'ECONNREFUSED'
      });

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {'generate-config': true});

    nightwatchInit.askQuestions = function() {
      return answers;
    };

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    new Promise(resolve => {
      setTimeout(function() {
        assert.ok(scope.isDone());
        resolve();
      }, 0);

      rmDirSync(rootDir);
    });
  });

  it('make sure we do not send analytics data if allowAnalytics is set to false', async function() {
    const consoleOutput = [];
    mockLogger(consoleOutput);

    const commandsExecuted = [];
    mockery.registerMock('child_process', {
      execSync(command, options) {
        commandsExecuted.push(command);
      }
    });

    const answers = {
      testingType: ['e2e'],
      language: 'ts',
      runner: 'nightwatch',
      backend: 'both',
      cloudProvider: 'other',
      browsers: ['firefox'],
      remoteBrowsers: ['chrome'],
      baseUrl: 'https://nightwatchjs.org',
      testsLocation: 'tests',
      allowAnonymousMetrics: false
    };

    nock('https://www.google-analytics.com')
      .post('/mp/collect?api_secret=XuPojOTwQ6yTO758EV4hBg&measurement_id=G-DEKPKZSLXS')
      .reply(204, (uri, requestBody) => {
        assert.fail();
      });

    const NightwatchInitiator = require('../../lib/NightwatchInitiator').default;
    const nightwatchInit = new NightwatchInitiator(rootDir, {'generate-config': true});

    nightwatchInit.askQuestions = function() {
      return answers;
    };

    const configPath = path.join(rootDir, 'nightwatch.conf.js');
    nightwatchInit.getConfigDestPath = function() {
      return configPath;
    };

    await nightwatchInit.run();

    rmDirSync(rootDir);
  });
});
