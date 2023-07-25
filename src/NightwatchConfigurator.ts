import path from 'path';
import fs from 'node:fs';
import PackageJson from '@npmcli/package-json';
import colors from 'ansi-colors';
import Logger from './logger';
import minimist from 'minimist';
import {installPackages, copyAppTestingExamples, postMobileSetupInstructions, loadNightwatchConfig} from './common';
import {AndroidSetup, IosSetup} from '@nightwatch/mobile-helper';
import {UI_FRAMEWORK_QUESTIONS, MOBILE_BROWSER_CHOICES, MOBILE_PLATFORM_QUES, DEFAULT_FOLDER, EXAMPLE_TEST_FOLDER} from './constants';
import {ConfigGeneratorAnswers, MobileHelperResult, NightwatchConfig} from './interfaces';
import NPMCliPackageJson from '@npmcli/package-json';

export default class NightwatchConfigurator {
  private nightwatchPkgConfig: {[key: string]: any};
  private nightwatchConfigFile: NightwatchConfig | false;
  private packageJson: NPMCliPackageJson | undefined;
  private rootDir: string;
  private argv: minimist.ParsedArgs;

  private static supportedFlags: string[] = ['add'];

  constructor(argv: minimist.ParsedArgs, rootDir = './') {
    this.rootDir = rootDir;
    this.argv = argv;
    this.nightwatchConfigFile = false;
    this.nightwatchPkgConfig = {};
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static hasSupportedFlags(argv: minimist.ParsedArgs) {
    for (const arg in argv) {
      if (this.supportedFlags.includes(arg)) {
        return true;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async run() {
    if (this.argv.add) {
      await this.addComponents(this.argv.add);
    }

    // Other commands can be added later on
  }

  private async loadConfig(): Promise<void> {
    this.packageJson = await PackageJson.load(this.rootDir);
    this.nightwatchPkgConfig = (<{[key: string]: any}> this.packageJson.content).nightwatch || {};
    this.nightwatchPkgConfig.plugins = this.nightwatchPkgConfig.plugins || [];
    this.nightwatchPkgConfig.test_settings = this.nightwatchPkgConfig.test_settings || {};

    this.nightwatchConfigFile = loadNightwatchConfig(this.packageJson, this.argv.config);
  }

  public async addComponents(name: string): Promise<void> {
    try {
      await this.loadConfig();

      switch (name) {
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
          this.printHelpForAdd();

          return;
      }

      await this.updatePackageJson();
    } catch (err) {
      Logger.error(`Failed to add components: ${err}`);
    }
  }

  private async updatePackageJson() {
    const packageJson = await PackageJson.load(this.rootDir);

    packageJson.update({
      nightwatch: this.nightwatchPkgConfig
    } as {[key: string]: any});

    await packageJson.save();
  }

  private async addVrt() {
    Logger.info('Setting up Visual Regression Testing for Nightwatch...');
    if (!this.isPluginConfigured(['@nightwatch/vrt'])) {
      this.nightwatchPkgConfig.plugins.push('@nightwatch/vrt');
      installPackages(['@nightwatch/vrt'], this.rootDir);

      Logger.info(`
    To use the vrt plugin, use the following assertion:
      browser
        .url('https://nightwatchjs.org')
        .assert.screenshotIdenticalToBaseline('body',  /* Optional */ 'custom-name', {threshold: 0.0}, 'VRT custom-name complete.')
        .end()

    For More information visit: https://github.com/nightwatchjs/nightwatch-vrt
      `);
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
      this.nightwatchPkgConfig.vite_dev_server = {
        start_vite: true,
        port: 5173
      };

      this.nightwatchPkgConfig.baseUrl = 'http://localhost:5173';
    }

    if (answers.uiFramework === 'storybook') {
      this.nightwatchPkgConfig['@nightwatch/storybook'] = {
        start_storybook: true,
        storybook_config_dir: '.storybook',
        hide_csf_errors: true,
        show_browser_console: true,
        storybook_url: 'http://localhost:6006'
      };

      this.nightwatchPkgConfig.baseUrl = 'http://localhost:6006';
    }
  }

  private isPluginConfigured(plugins: string[]): boolean {
    for (const plugin in plugins) {
      if (this.nightwatchPkgConfig.plugins.includes(plugin) ||
         (this.nightwatchConfigFile && this.nightwatchConfigFile.plugins?.includes(plugin))
      ) {
        return true;
      }
    }

    return false;
  }

  private async addComponentTesting() {
    const {default: {prompt}} = await import('inquirer');

    Logger.info('Setting up Component Testing for Nightwatch...');

    const answers = await prompt([UI_FRAMEWORK_QUESTIONS]);

    const pluginInstall = `@nightwatch/${answers.uiFramework}`;
    if (!this.isPluginConfigured([pluginInstall])) {
      this.nightwatchPkgConfig.plugins.push(pluginInstall);
      installPackages([pluginInstall], this.rootDir);
      this.addComponentTestingConfig(answers);
    } else {
      Logger.info('Component Testing is already configured');
    }
  }

  private async addAPITesting() {
    Logger.info('Setting up Unit Testing for Nightwatch...');
    if (!this.isPluginConfigured(['@nightwatch/apitesting'])) {
      const packages = ['@nightwatch/apitesting'];
      this.nightwatchPkgConfig.plugins.push('@nightwatch/apitesting');

      if (!this.isPluginConfigured(['@nightwatch/testdoubles'])) {
        packages.push('@nightwatch/testdoubles');
        this.nightwatchPkgConfig.plugins.push('@nightwatch/testdoubles');
      }

      installPackages(packages, this.rootDir);

      this.nightwatchPkgConfig.test_settings.default = this.nightwatchPkgConfig.test_settings.default || {};
      this.nightwatchPkgConfig.test_settings.default.webdriver = this.nightwatchPkgConfig.test_settings.default.webdriver || {};
      this.nightwatchPkgConfig.test_settings.default.start_session = false;
      this.nightwatchPkgConfig.test_settings.default.webdriver.start_process = false;

      // Inform the user in case nightwatch.conf.js
      Logger.info(`Make sure browser session is turned off during API testing (in nightwatch.conf.js): 
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
    const dotExe = process.platform === 'win32' ? '.exe' : '';

    if (answers.mobileBrowsers?.includes('firefox')) {
      this.nightwatchPkgConfig.test_settings['android.real.firefox'] = {
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

      this.nightwatchPkgConfig.test_settings['android.emulator.firefox'] = {
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
      this.nightwatchPkgConfig.test_settings['android.real.chrome'] = {
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

      this.nightwatchPkgConfig.test_settings['android.emulator.chrome'] = {
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
          server_path: `chromedriver-mobile/chromedriver${dotExe}`,
          cli_args: [
            // --verbose
          ]
        }
      };
    }

    if (answers.mobileBrowsers?.includes('safari')) {
      this.nightwatchPkgConfig.test_settings['ios.real.safari'] = {
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

      this.nightwatchPkgConfig.test_settings['ios.simulator.safari'] = {
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
      this.nightwatchPkgConfig.test_settings['app'] = {
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
      this.nightwatchPkgConfig.test_settings['app.android.emulator'] = {
        extends: 'app',
        'desiredCapabilities': {
          browserName: null,
          platformName: 'android',
          'appium:options': {
            automationName: 'UiAutomator2',
            // Android Virtual Device to run tests on
            avd: 'nightwatch-android-11',
            app: `${this.rootDir}/nightwatch/sample-apps/wikipedia.apk`,
            appPackage: 'org.wikipedia',
            appActivity: 'org.wikipedia.main.MainActivity',
            appWaitActivity: 'org.wikipedia.onboarding.InitialOnboardingActivity',
            chromedriverExecutable: `${this.rootDir}/chromedriver-mobile/chromedriver${dotExe}`,
            newCommandTimeout: 0
          }
        }
      },

      this.nightwatchPkgConfig.test_settings['app.android.real'] = {
        extends: 'app',
        'desiredCapabilities': {
          // More capabilities can be found at https://github.com/appium/appium-uiautomator2-driver#capabilities
          browserName: null,
          platformName: 'android',
          'appium:options': {
            automationName: 'UiAutomator2',
            app: `${this.rootDir}/nightwatch/sample-apps/wikipedia.apk`,
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
      this.nightwatchPkgConfig.test_settings['app.ios.simulator'] = {
        extends: 'app',
        'desiredCapabilities': {
          // More capabilities can be found at https://github.com/appium/appium-xcuitest-driver#capabilities
          browserName: null,
          platformName: 'ios',
          'appium:options': {
            automationName: 'XCUITest',
            deviceName: 'iPhone 13',
            app: `${this.rootDir}/nightwatch/sample-apps/wikipedia.zip`,
            bundleId: 'org.wikimedia.wikipedia',
            newCommandTimeout: 0
          }
        }
      };

      this.nightwatchPkgConfig.test_settings['app.ios.real'] = {
        extends: 'app',
        'desiredCapabilities': {
          browserName: null,
          platformName: 'ios',
          'appium:options': {
            automationName: 'XCUITest',
            app: `${this.rootDir}/nightwatch/sample-apps/wikipedia.zip`,
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
      {
        type: 'checkbox',
        name: 'mobileBrowsers',
        message: 'Select target mobile-browsers',
        choices: (answers: ConfigGeneratorAnswers) => {
          let browsers = MOBILE_BROWSER_CHOICES;

          if (process.platform !== 'darwin') {
            browsers = browsers.filter((browser) => browser.value !== 'safari');
          }

          if (answers.mobilePlatform === 'ios') {
            browsers = browsers.filter((browser) => browser.value === 'safari');
          }

          return browsers;
        },
        default: (answers: ConfigGeneratorAnswers) => {
          if (answers.mobilePlatform === 'ios' || answers.mobilePlatform === 'both' && process.platform === 'darwin') {
            return ['safari'];
          } else {
            return ['chrome'];
          }
        },
        validate: (value) => {
          return !!value.length || 'Please select at least 1 browser.';
        }
      }
    ]);

    answers.examplesLocation = path.join(DEFAULT_FOLDER, EXAMPLE_TEST_FOLDER);
    answers.mobile = true;

    if (answers.mobilePlatform === 'ios' && this.nightwatchPkgConfig?.test_settings && this.nightwatchPkgConfig?.test_settings['ios.real.safari']) {
      Logger.info('Mobile Testing is already configured for iOS.');

      return;
    }

    if (answers.mobilePlatform === 'android' && this.nightwatchPkgConfig?.test_settings
      && (this.nightwatchPkgConfig?.test_settings['android.real.chrome'] 
      || this.nightwatchPkgConfig?.test_settings['android.real.firefox'])
    ) {
      Logger.info('Mobile Testing is already configured for Android.');

      return;
    }

    if (answers.mobilePlatform === 'both' && this.nightwatchPkgConfig?.test_settings
      && (this.nightwatchPkgConfig?.test_settings['android.real.chrome'] 
      || this.nightwatchPkgConfig?.test_settings['android.real.firefox']
      || this.nightwatchPkgConfig?.test_settings['ios.real.safari'])
    ) {
      Logger.info('Mobile Testing is already configured.');

      return;
    }

    installPackages(['@nightwatch/mobile-helper', 'appium'], this.rootDir);

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
    postMobileSetupInstructions(answers, mobileHelperResult, '', this.rootDir, '');
  }

  private printHelpForAdd() {
    const message = `
    Invalid argument passed to ${colors.cyan('--add')}, available options are:
        ${colors.yellow('component-testing')}       :: Adds support for component testing using React, Vue, etc.
        ${colors.yellow('unit-testing')}            :: Adds support for unit testing / api testing.
        ${colors.yellow('vrt')}                     :: Adds support for Visual Regression testing.
        ${colors.yellow('mobile-testing')}          :: Sets up tools to run tests on real mobile devices using Nightwatch. 
    `;

    // eslint-disable-next-line no-console
    console.log(message);
  }
}