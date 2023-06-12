import path from 'path';
import fs from 'node:fs';
import PackageJson from '@npmcli/package-json';
import colors from 'ansi-colors';
import Logger from './logger';
import {installPackages, copyAppTestingExamples, postMobileSetupInstructions} from './common';
import {AndroidSetup, IosSetup} from '@nightwatch/mobile-helper';
import {UI_FRAMEWORK_QUESTIONS, MOBILE_BROWSER_QUES, MOBILE_PLATFORM_QUES, DEFAULT_FOLDER} from './constants';
import {ConfigGeneratorAnswers, MobileHelperResult} from './interfaces';

export default class NightwatchConfigurator {
  private pkgJsonPath: string;
  private nightwatchConfig: any;
  private rootDir: string;
  private advice: string[];

  constructor(pkgJsonPath = './') {
    this.pkgJsonPath = pkgJsonPath;
    this.rootDir = path.resolve('./');
    this.advice = [];
  }

  public async addComponents(argv: {[key: string]: string}) {
    if (!argv.add) {
      Logger.error('Invalid argument, expected `--add` to be present');

      return;
    }

    try {
      const packageJson = await PackageJson.load(this.pkgJsonPath);
      this.nightwatchConfig = (<{[key: string]: string}> packageJson.content).nightwatch || {};

      this.nightwatchConfig.plugins = this.nightwatchConfig.plugins || [];

      switch (argv.add) {
        case 'component-testing':
          await this.addComponentTesting();
          break;

        case 'vrt':
          await this.addVrt();
          break;

        case 'mobile':
        case 'mobile-testing':
          await this.addMobileTesting();
          break;

        case 'unit-testing':
        case 'api-testing':
          await this.addAPITesting();
          break;

        default:
          this.printHelp();
      }

      await this.updatePackageJson();
      this.printAdvice();
    } catch (err) {
      Logger.error(`Failed to add components: ${err}`);
    }
  }

  private async updatePackageJson() {
    const packageJson = await PackageJson.load();

    packageJson.update({
      nightwatch: this.nightwatchConfig
    } as {[key: string]: string});

    await packageJson.save();
  }

  private async addVrt() {
    Logger.info('Setting up Visual Regression Testing for Nightwatch...');
    if (!this.nightwatchConfig.plugins.includes('@nightwatch/vrt')) {
      this.nightwatchConfig.plugins.push('@nightwatch/vrt');
      installPackages(['@nightwatch/vrt'], this.rootDir);

      // TODO: check if we need to add additional configurations
    } else {
      Logger.info('Visual Regression Testing is already configured.');
    }
  }

  private addComponentTestingConfig(answers: ConfigGeneratorAnswers) {
    if (answers.uiFramework === 'react') {
      const componentConfigPath = path.join(__dirname, '..', 'assets', 'component-config');
      const nightwatchPath = path.join(this.rootDir, DEFAULT_FOLDER);

      try {
        fs.mkdirSync(nightwatchPath);
        // eslint-disable-next-line
      } catch (err) {}

      // Generate a new index.jsx file
      const reactIndexSrcPath = path.join(componentConfigPath, 'index.jsx');
      const reactIndexDestPath = path.join(nightwatchPath, 'index.jsx');

      fs.copyFileSync(reactIndexSrcPath, reactIndexDestPath);
    }

    if (answers.uiFramework === 'react' || answers.uiFramework === 'vue') {
      this.nightwatchConfig.vite_dev_server = {
        start_vite: true,
        port: 5173
      };

      this.nightwatchConfig.baseUrl = 'http://localhost:5173';
    }

    if (answers.uiFramework === 'storybook') {
      this.nightwatchConfig['@nightwatch/storybook'] = {
        start_storybook: true,
        storybook_config_dir: '.storybook',
        hide_csf_errors: true,
        show_browser_console: true,
        storybook_url: 'http://localhost:6006'
      };

      this.nightwatchConfig.baseUrl = 'http://localhost:6006';
    }
  }

  private async addComponentTesting() {
    const {default: {prompt}} = await import('inquirer');

    Logger.info('Setting up Component Testing for Nightwatch...');

    const answers = await prompt([UI_FRAMEWORK_QUESTIONS]);

    const pluginInstall = `@nightwatch/${answers.uiFramework}`;
    if (!this.nightwatchConfig.plugins.includes(pluginInstall)) { // TODO: we need to check if plugin is present in nightwatch.conf.js as well
      this.nightwatchConfig.plugins.push(pluginInstall);
      installPackages([pluginInstall], this.rootDir);
      this.addComponentTestingConfig(answers);
    } else {
      Logger.info('Component Testing is already configured');
    }
  }

  private async addAPITesting() {
    Logger.info('Setting up Unit Testing for Nightwatch...');
    if (!this.nightwatchConfig.plugins.includes('@nightwatch/apitesting')) {
      const packages = ['@nightwatch/apitesting'];
      this.nightwatchConfig.plugins.push('@nightwatch/apitesting');

      if (!this.nightwatchConfig.plugins.includes('@nightwatch/testdoubles')) {
        packages.push('@nightwatch/testdoubles');
        this.nightwatchConfig.plugins.push('@nightwatch/testdoubles');
      }

      installPackages(packages, this.rootDir);

      // TODO: check if we need to add config
      this.advice.push(`Make sure browser session is turned off during API testing: 
      {
        "start_session": false,
        "webdriver": {
          "start_process": false
        }
      }
    `);
    } else {
      Logger.info('Unit/API Testing is already configured');
    }
  }

  private addMobileTestingConfig(answers: ConfigGeneratorAnswers) {
    this.nightwatchConfig.test_settings = this.nightwatchConfig.test_settings || {};

    if (answers.mobileBrowsers?.includes('firefox')) {
      this.nightwatchConfig.test_settings['android.real.firefox'] = {
        desiredCapabilities: {
          real_mobile: true,
          browserName: 'firefox',
          acceptInsecureCerts: true,
          'moz:firefoxOptions': {
            args: [],
            androidPackage: 'org.mozilla.firefox'
          }
        },
        webdriver: {
          start_process: true,
          server_path: ''
        }
      };

      this.nightwatchConfig.test_settings['android.emulator.firefox'] = {
        desiredCapabilities: {
          real_mobile: false,
          avd: 'nightwatch-android-11',
          browserName: 'firefox',
          acceptInsecureCerts: true,
          'moz:firefoxOptions': {
            args: [],
            androidPackage: 'org.mozilla.firefox'
          }
        },
        webdriver: {
          start_process: true,
          server_path: '',
          cli_args: []
        }
      };
    }

    if (answers.mobileBrowsers?.includes('chrome')) {
      this.nightwatchConfig.test_settings['android.real.chrome'] = {
        desiredCapabilities: {
          real_mobile: true,
          browserName: 'chrome',
          'goog:chromeOptions': {
            w3c: true,
            args: [],
            androidPackage: 'com.android.chrome'
          }
        },

        webdriver: {
          start_process: true,
          server_path: '',
          cli_args: []
        }
      };

      this.nightwatchConfig.test_settings['android.emulator.chrome'] = {
        desiredCapabilities: {
          real_mobile: false,
          avd: 'nightwatch-android-11',
          browserName: 'chrome',
          'goog:chromeOptions': {
            w3c: true,
            args: [],
            androidPackage: 'com.android.chrome'
          }
        },

        webdriver: {
          start_process: true,
          // path to chromedriver executable which can work with the factory
          // version of Chrome mobile browser on the emulator (version 83).
          server_path: 'chromedriver-mobile/chromedriver<%- dotExe %>',
          cli_args: [
            // --verbose
          ]
        }
      };
    }

    if (answers.mobileBrowsers?.includes('safari')) {
      this.nightwatchConfig.test_settings['ios.real.safari'] = {
        desiredCapabilities: {
          browserName: 'safari',
          platformName: 'iOS'
        },

        webdriver: {
          start_process: true,
          server_path: '',
          cli_args: []
        }
      };

      this.nightwatchConfig.test_settings['ios.simulator.safari'] = {
        desiredCapabilities: {
          browserName: 'safari',
          platformName: 'iOS',
          'safari:useSimulator': true,
          'safari:deviceName': 'iPhone 13'
        },

        webdriver: {
          start_process: true,
          server_path: '',
          cli_args: []
        }
      };
    }

    if (answers.testingType?.includes('app')) {
      this.nightwatchConfig.test_settings['app'] = {
        selenium: {
          start_process: true,
          use_appium: true,
          host: 'localhost',
          port: 4723,
          server_path: '',
          // args to pass when starting the Appium server
          cli_args: [
          ]
        },
        webdriver: {
          timeout_options: {
            timeout: 150000,
            retry_attempts: 3
          },
          keep_alive: false,
          start_process: false
        }
      };
    }

    if (answers.mobilePlatform && ['android', 'both'].includes(answers.mobilePlatform)) {
      this.nightwatchConfig.test_settings['app.android.emulator'] = {
        extends: 'app',
        'desiredCapabilities': {
          browserName: null,
          platformName: 'android',
          'appium:options': {
            automationName: 'UiAutomator2',
            // Android Virtual Device to run tests on
            avd: 'nightwatch-android-11',
            //TODO: fix this
            app: `${__dirname}/nightwatch/sample-apps/wikipedia.apk`,
            appPackage: 'org.wikipedia',
            appActivity: 'org.wikipedia.main.MainActivity',
            appWaitActivity: 'org.wikipedia.onboarding.InitialOnboardingActivity',
            // TODO: fix this
            chromedriverExecutable: `${__dirname}/chromedriver-mobile/chromedriver<%- dotExe %>`,
            newCommandTimeout: 0
          }
        }
      },

      this.nightwatchConfig.test_settings['app.android.real'] = {
        extends: 'app',
        'desiredCapabilities': {
          // More capabilities can be found at https://github.com/appium/appium-uiautomator2-driver#capabilities
          browserName: null,
          platformName: 'android',
          'appium:options': {
            automationName: 'UiAutomator2',

            // TODO: fix this
            app: `${__dirname}/nightwatch/sample-apps/wikipedia.apk`,
            appPackage: 'org.wikipedia',
            appActivity: 'org.wikipedia.main.MainActivity',
            appWaitActivity: 'org.wikipedia.onboarding.InitialOnboardingActivity',
            chromedriverExecutable: '',
            newCommandTimeout: 0
          }
        }
      };
    }

    if (answers.mobilePlatform && ['ios', 'both'].includes(answers.mobilePlatform)) {
      this.nightwatchConfig.test_settings['app.ios.simulator'] = {
        extends: 'app',
        'desiredCapabilities': {
          // More capabilities can be found at https://github.com/appium/appium-xcuitest-driver#capabilities
          browserName: null,
          platformName: 'ios',
          'appium:options': {
            automationName: 'XCUITest',
            deviceName: 'iPhone 13',

            // TODO: fix this
            app: `${__dirname}/nightwatch/sample-apps/wikipedia.zip`,
            bundleId: 'org.wikimedia.wikipedia',
            newCommandTimeout: 0
          }
        }
      };

      this.nightwatchConfig.test_settings['app.ios.real'] = {
        extends: 'app',
        'desiredCapabilities': {
          browserName: null,
          platformName: 'ios',
          'appium:options': {
            automationName: 'XCUITest',
            //TODO: fix this
            app: `${__dirname}/nightwatch/sample-apps/wikipedia.zip`,
            bundleId: 'org.wikimedia.wikipedia',
            newCommandTimeout: 0
          }
        }
      };
    }
  }

  private async addMobileTesting() {
    const {default: {prompt}} = await import('inquirer');

    Logger.info('Setting up Component Testing for Nightwatch...');

    const mobileHelperResult:MobileHelperResult = {};
    const answers = await prompt([
      MOBILE_PLATFORM_QUES,
      MOBILE_BROWSER_QUES
    ]);

    installPackages(['@nightwatch/mobile-helper', 'appium'], this.rootDir);

    // import components form mobile-helper and execute them

    if (['android', 'both'].includes(answers.mobilePlatform)) {
      Logger.info('Running Android Setup...\n');
      const androidSetup = new AndroidSetup({
        appium: true
      }, this.rootDir);
      mobileHelperResult.android = await androidSetup.run();
    }

    if (['ios', 'both'].includes(answers.mobilePlatform)) {
      Logger.info('Running iOS Setup...\n');
      const iosSetup = new IosSetup({mode: ['simulator', 'real'], setup: true});
      mobileHelperResult.ios = await iosSetup.run();
    }

    await copyAppTestingExamples(answers, this.rootDir);
    this.addMobileTestingConfig(answers);
    postMobileSetupInstructions(answers, mobileHelperResult, '', this.rootDir, '', false);
  }

  private printHelp() {
    // TODO: load this from a common place
    const message = `
    Invalid argument passed to ${colors.cyan('--install')}, available options are:
        ${colors.yellow('component-testing')}       :: Adds support for component testing using React, Vue, etc.
        ${colors.yellow('unit-testing')}            :: Adds support for unit testing / api testing.
        ${colors.yellow('vrt')}                     :: Adds support for Visual Regression testing.
        ${colors.yellow('mobile-testing')}          :: Sets up tools to run tests on real mobile devices using Nightwatch. 
    `;

    // eslint-disable-next-line no-console
    console.log(message);
  }

  private printAdvice() {
    Logger.info(this.advice.join('\n'));
  }
}