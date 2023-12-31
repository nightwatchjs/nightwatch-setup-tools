import fs from 'node:fs';
import path from 'path';
import ejs from 'ejs';
import colors from 'ansi-colors';
import https from 'https';
import {prompt} from 'inquirer';
import {execSync} from 'child_process';
import {ParsedArgs} from 'minimist';
import {v4 as uuid} from 'uuid';
import {copy, stripControlChars, symbols} from './utils';
import Logger from './logger';
import {copyAppTestingExamples, installPackages, postMobileSetupInstructions} from './common';

import {
  CONFIG_INTRO, QUESTIONAIRRE, CONFIG_DEST_QUES, MOBILE_BROWSER_CHOICES, Runner,
  isAppTestingSetup, isLocalMobileTestingSetup, isWebTestingSetup, EXAMPLE_TEST_FOLDER, DEFAULT_FOLDER
} from './constants';
import {ConfigGeneratorAnswers, ConfigDestination, OtherInfo, MobileHelperResult} from './interfaces';
import defaultAnswers from './defaults.json';
import defaultMobileAnswers from './defaultsMobile.json';
import defaultAppAnswers from './defaultsApp.json';
import {AndroidSetup, IosSetup} from '@nightwatch/mobile-helper';
import {format} from 'node:util';

export default class NightwatchInitiator {
  rootDir: string;
  options: Omit<ParsedArgs, '_'>;
  otherInfo: OtherInfo;
  onlyConfig: boolean;
  client_id: string;

  constructor(rootDir = process.cwd(), options: Omit<ParsedArgs, '_'>) {
    this.rootDir = rootDir;
    this.options = options;
    this.otherInfo = {};
    this.onlyConfig = false;
    this.client_id = uuid();
  }

  async run() {
    let answers: ConfigGeneratorAnswers = {};

    if (this.options?.['generate-config']) {
      this.onlyConfig = true;
    }

    if (this.options?.yes) {
      if (this.options?.mobile) {
        answers = defaultMobileAnswers as ConfigGeneratorAnswers;

        if (this.options?.browser) {
          answers.mobileBrowsers = this.options.browser;
        }
      } else if (this.options?.native) {
        answers = defaultAppAnswers as ConfigGeneratorAnswers;
      } else {
        answers = defaultAnswers as ConfigGeneratorAnswers;

        if (this.options?.browser) {
          answers.browsers = this.options.browser;
        }
      }
    } else {
      Logger.info(format(CONFIG_INTRO, this.rootDir));

      answers = await this.askQuestions();
      // Add a newline after questions.
      Logger.info();
    }

    this.refineAnswers(answers);

    // Install Packages
    const packagesToInstall = this.identifyPackagesToInstall(answers);
    installPackages(packagesToInstall, this.rootDir);

    // Setup TypeScript
    if (!this.onlyConfig && answers.language === 'ts') {
      this.setupTypescript();
    }

    // Check if Java is installed on the system
    if (answers.seleniumServer) {
      this.checkJavaInstallation();
    }

    // Install drivers
    const driversToInstall = this.identifyDriversToInstall(answers);
    if (driversToInstall.length) {
      await this.installDrivers(driversToInstall);
    }

    if (!this.onlyConfig) {
      // Create tests location
      if (answers.testsLocation) {
        this.createTestLocation(answers.testsLocation);
      }

      // Copy examples
      // For cucumber, only copy the cucumber examples.
      // For rest, copy all examples but cucumber.
      if (answers.runner === Runner.Cucumber) {
        this.copyCucumberExamples(answers.examplesLocation || '');
      } else if (answers.addExamples) {
        if (isWebTestingSetup(answers)) {
          this.copyExamples(answers.examplesLocation || '', answers.language === 'ts');
        }

        if (isAppTestingSetup(answers)) {
          await copyAppTestingExamples(answers, this.rootDir);
        }

        // For now the templates added only for JS
        if (answers.language !== 'ts' && isWebTestingSetup(answers)) {
          this.copyTemplates(path.join(answers.examplesLocation || ''));
        }
      }
    }

    // Setup component testing
    if (answers.testingType?.includes('component')) {
      this.setupComponentTesting(answers);
    }

    // Generate configuration file
    const configDestPath = await this.getConfigDestPath();
    this.generateConfig(answers, configDestPath);

    // Setup mobile
    const mobileHelperResult: MobileHelperResult = {};

    if (isLocalMobileTestingSetup(answers) && answers.mobilePlatform) {
      // answers.mobilePlatform will be undefined in case of empty or non-matching mobileBrowsers
      // hence, no need to setup any device.
      if (['android', 'both'].includes(answers.mobilePlatform)) {
        Logger.info('Running Android Setup...\n');
        const androidSetup = new AndroidSetup({
          browsers: answers.mobileBrowsers || [],
          ...(isAppTestingSetup(answers) && {appium: true})
        }, this.rootDir);
        mobileHelperResult.android = await androidSetup.run();
      }

      if (['ios', 'both'].includes(answers.mobilePlatform)) {
        Logger.info('Running iOS Setup...\n');
        const iosSetup = new IosSetup({mode: ['simulator', 'real'], setup: true});
        mobileHelperResult.ios = await iosSetup.run();
      }
    }

    if (!this.onlyConfig) {
      // Post instructions to run their first test
      this.postSetupInstructions(answers, mobileHelperResult);
    } else {
      // Post config instructions
      this.postConfigInstructions(answers);
    }

    if (answers.allowAnonymousMetrics) {
      Logger.info('Note: Nightwatch collects anonymous usage data to improve user experience. You can turn it off in nightwatch.conf.js');
      try {
        this.pushAnonymousMetrics(answers);
      } catch (err) {
        // do nothing
      }
    }
  }

  async askQuestions() {
    const answers = {
      rootDir: this.rootDir,
      onlyConfig: this.onlyConfig,
      browsers: this.options?.browser,
      ...(this.options?.mobile && {mobile: true}),
      ...(this.options?.native && {native: true})
    };

    return await prompt(QUESTIONAIRRE, answers);
  }

  refineAnswers(answers: ConfigGeneratorAnswers) {
    const onlyAppTestingSetup = answers.testingType && answers.testingType.length === 1 && answers.testingType[0] === 'app';
    const backendHasLocal = answers.backend && ['local', 'both'].includes(answers.backend);
    const backendHasRemote = answers.backend && ['remote', 'both'].includes(answers.backend);

    if (backendHasRemote) {
      answers.remoteName = 'remote';
      if (answers.cloudProvider !== 'other') {
        answers.remoteName = answers.cloudProvider;
      }

      answers.remoteEnv = {
        username: 'REMOTE_USERNAME',
        access_key: 'REMOTE_ACCESS_KEY'
      };
      if (answers.cloudProvider === 'browserstack') {
        answers.remoteEnv.username = 'BROWSERSTACK_USERNAME';
        answers.remoteEnv.access_key = 'BROWSERSTACK_ACCESS_KEY';
      } else if (answers.cloudProvider === 'saucelabs') {
        answers.remoteEnv.username = 'SAUCE_USERNAME';
        answers.remoteEnv.access_key = 'SAUCE_ACCESS_KEY';
      }

      if (!answers.remoteBrowsers) {
        if (answers.browsers) {
          // we are testing on desktop browsers
          // Copy all desktop browsers from `answers.browsers`.
          answers.remoteBrowsers = [...answers.browsers];
        } else {
          // we are not testing on desktop browsers
          answers.remoteBrowsers = [];
        }
      }

      if (answers.mobile) {
        // we are testing on mobile browsers
        // right now, we are putting one config for all browsers.
        answers.mobileRemote = true;
      }

      // If backend is only remote (no local), delete answers.browsers (if present)
      // and set the defaultBrowser.
      if (!backendHasLocal) {
        if (answers.browsers) {
          delete answers.browsers;
        }
        answers.defaultBrowser = answers.remoteBrowsers[0] || (onlyAppTestingSetup ? '' : 'chrome');
      }
    }

    if (backendHasLocal) {
      if (answers.browsers) {
        // we are testing on desktop browsers

        // Remove safari from answers.browsers for non-mac users
        if (process.platform !== 'darwin' && answers.browsers.includes('safari')) {
          const pos = answers.browsers.indexOf('safari');
          answers.browsers.splice(pos, 1);
        }
      } else {
        // we are not testing on desktop browsers
        answers.browsers = [];
      }

      if (answers.mobile) {
        // we are testing on mobile browsers
        if (answers.mobileBrowsers) {
          // Remove safari from answers.mobileBrowsers for non-mac users (if present)
          if (process.platform !== 'darwin' && answers.mobileBrowsers.includes('safari')) {
            const pos = answers.mobileBrowsers.indexOf('safari');
            answers.mobileBrowsers.splice(pos, 1);
          }
        } else {
          // copy browsers from `answers.browsers` (safari already removed)
          // will be empty if `answers.browsers` is empty.
          answers.mobileBrowsers = MOBILE_BROWSER_CHOICES
            .map((browserObj) => browserObj.value)
            .filter((browser) => answers.browsers?.includes(browser));
        }
      } else {
        // we are not testing on mobile browsers
        answers.mobileBrowsers = [];
      }

      // Set defaultBrowser
      if (!answers.defaultBrowser) {
        answers.defaultBrowser = answers.browsers[0] || answers.mobileBrowsers[0] || (onlyAppTestingSetup ? '' : 'chrome');
      }
    }

    // Make sure baseUrl is not undefined
    answers.baseUrl = answers.baseUrl || '';

    // Always generate examples (for now)
    if (!this.onlyConfig) {
      answers.addExamples = true;
    }

    // Set testsLocation to default if not present
    if (!answers.testsLocation) {
      answers.testsLocation = defaultAnswers.testsLocation;
    }

    if (answers.addExamples && !answers.examplesLocation) {
      if (answers.runner === Runner.Cucumber) {
        answers.examplesLocation = path.join(answers.featurePath || '', DEFAULT_FOLDER);
      } else {
        answers.examplesLocation = DEFAULT_FOLDER;
      }
    }

    if (answers.mobile && !answers.mobilePlatform) {
      if (answers.mobileBrowsers?.includes('safari')) {
        answers.mobilePlatform = 'ios';
      }

      if (answers.mobileBrowsers?.some(browser => ['chrome', 'firefox'].includes(browser))) {
        if (answers.mobilePlatform === 'ios') {
          answers.mobilePlatform = 'both';
        } else {
          answers.mobilePlatform = 'android';
        }
      }
    }

    if (isAppTestingSetup(answers) && !answers.mobilePlatform) {
      answers.mobilePlatform = 'android';
    }

    // Remove ios from mobilePlatform on non-mac systems (if present)
    if (process.platform !== 'darwin' && answers.mobilePlatform) {
      if (answers.mobilePlatform === 'both') {
        answers.mobilePlatform = 'android';
      } else if (answers.mobilePlatform === 'ios') {
        Logger.error(`${colors.red('Error: Testing on iOS devices is not supported on non-mac systems.')}`);
        answers.mobilePlatform = undefined;
      }
    }

    if (answers.uiFramework) {
      answers.plugins = answers.plugins || [];
      answers.plugins.push(`@nightwatch/${answers.uiFramework}`);
    }
  }

  identifyPackagesToInstall(answers: ConfigGeneratorAnswers): string[] {
    const packages: string[] = ['nightwatch'];

    if (answers.language === 'ts') {
      packages.push('typescript', '@swc/core', 'ts-node');
    }

    if (answers.runner === Runner.Cucumber) {
      packages.push('@cucumber/cucumber');
    }

    if (answers.seleniumServer) {
      packages.push('@nightwatch/selenium-server');
    }

    if (isAppTestingSetup(answers) && answers.backend !== 'remote') {
      packages.push('appium');
    }

    if (answers.plugins) {
      packages.push(...answers.plugins);
    }
    
    // Identify packages already installed and don't install them again
    const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf-8'));

    const packagesToInstall = packages.filter((pack) => {
      // eslint-disable-next-line
      return !packageJson.devDependencies?.hasOwnProperty(pack) && !packageJson.dependencies?.hasOwnProperty(pack);
    });

    // Packages to always upgrade
    if (isLocalMobileTestingSetup(answers)) {
      packagesToInstall.push('@nightwatch/mobile-helper');
    }

    return packagesToInstall;
  }

  setupTypescript() {
    const tsConfigPath = path.join(this.rootDir, 'tsconfig.json');

    // Generate a new tsconfig.json file if not already present.
    if (!fs.existsSync(tsConfigPath)) {
      execSync('npx tsc --init', {
        stdio: 'inherit',
        cwd: this.rootDir
      });
      Logger.info();
    }

    // Generate a new tsconfig.json file to be used by ts-node, if not already present.
    const tsConfigNightwatchPath1 = path.join(this.rootDir, 'nightwatch', 'tsconfig.json');
    const tsConfigNightwatchPath2 = path.join(this.rootDir, 'tsconfig.nightwatch.json');

    if (!fs.existsSync(tsConfigNightwatchPath1) && !fs.existsSync(tsConfigNightwatchPath2)) {
      const tsConfigSrcPath = path.join(__dirname, '..', 'assets', 'tsconfig.json');
      const tsConfigDestPath = path.join(this.rootDir, 'nightwatch', 'tsconfig.json');

      try {
        fs.mkdirSync(path.join(this.rootDir, 'nightwatch'));
        // eslint-disable-next-line
      } catch (err) {}

      fs.copyFileSync(tsConfigSrcPath, tsConfigDestPath);
    }

    // Set outDir property to null for now.
    this.otherInfo.tsOutDir = '';
  }

  setupComponentTesting(answers: ConfigGeneratorAnswers) {
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
  }

  checkJavaInstallation() {
    try {
      execSync('java -version', {
        stdio: 'pipe',
        cwd: this.rootDir
      });
    } catch (err) {
      this.otherInfo.javaNotInstalled = true;
    }
  }

  async getConfigDestPath() {
    if (this.options?.yes) {
      Logger.info('Auto-generating a configuration file...\n');
    } else {
      Logger.info('Generating a configuration file based on your responses...\n');
    }

    // check for ESM project
    const packageJson = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf-8'));
    const usingESM = packageJson.type === 'module';
    this.otherInfo.usingESM = usingESM;

    const configExt = usingESM ? '.conf.cjs' : '.conf.js';

    const configDestPath = path.join(this.rootDir, `nightwatch${configExt}`);

    if (fs.existsSync(configDestPath)) {
      Logger.info(colors.yellow(`There seems to be another config file located at "${configDestPath}".\n`));

      const answers: ConfigDestination = await prompt(CONFIG_DEST_QUES, {rootDir: this.rootDir, configExt});
      // Adding a newline after questions.
      Logger.info();

      if (!answers.overwrite) {
        const configFileName = `${answers.newFileName}${configExt}`;
        this.otherInfo.nonDefaultConfigName = configFileName;

        return path.join(this.rootDir, configFileName);
      }
    }

    return configDestPath;
  }

  generateConfig(answers: ConfigGeneratorAnswers, configDestPath: string) {
 
    const templateFile = path.join(__dirname, '..', 'src', 'config', 'main.ejs');

    const src_folders: string[] = []; // to go into the config file as the value of src_folders property.
    const page_objects_path: string[] = []; // to go as the value of page_objects_configs property.
    const custom_commands_path: string[] = []; // to go as the value of custom_commands_path property.
    const custom_assertions_path: string[] = []; // to go as the value of custom_assertions_path property.
    const feature_path = answers.featurePath || ''; // to be used in cucumber feature_path property.
    const plugins = answers.plugins || []; // to go as the value of plugins property.

    const testsJsSrc: string = path.join(this.otherInfo.tsOutDir || '', answers.testsLocation || '');
    if (testsJsSrc !== '.') {
      if (answers.testsLocation === answers.examplesLocation && answers.language === 'js' && answers.runner !== Runner.Cucumber) {
        // examples are being put as a boilerplate in testsLocation with main tests in
        // EXAMPLE_TEST_FOLDER sub-directory (only done for JS-Nightwatch and JS-Mocha).
        src_folders.push(path.join(testsJsSrc, EXAMPLE_TEST_FOLDER));
      } else {
        src_folders.push(testsJsSrc);
      }
      this.otherInfo.testsJsSrc = testsJsSrc;
    }

    if (answers.addExamples && answers.runner !== Runner.Cucumber) {
      // Add examplesLocation to src_folders, if different from testsLocation.
      // Don't add for cucumber examples (for now, as addition of examples depends upon featurePath in copyCucumberExamples).
      const examplesJsSrc: string = path.join(this.otherInfo.tsOutDir || '', answers.examplesLocation || '');
      if (examplesJsSrc !== testsJsSrc) {
        if (answers.language === 'js') {
          // Only for JS-Nightwatch and JS-Mocha.
          src_folders.push(path.join(examplesJsSrc, EXAMPLE_TEST_FOLDER));
        } else {
          src_folders.push(examplesJsSrc);
        }
      }
      this.otherInfo.examplesJsSrc = examplesJsSrc;

      if (isWebTestingSetup(answers) && answers.language === 'js') {
        // Right now, we only ship page-objects/custom-commands/custom-assertions
        // examples for web-tests in JS (Nightwatch and Mocha test runner) only.
        page_objects_path.push(`${path.join(examplesJsSrc, 'page-objects')}`);
        custom_commands_path.push(`${path.join(examplesJsSrc, 'custom-commands')}`);
        custom_assertions_path.push(`${path.join(examplesJsSrc, 'custom-assertions')}`);
      }
    }

    const tplData = fs.readFileSync(templateFile).toString();

    let rendered = ejs.render(tplData, {
      plugins: JSON.stringify(plugins).replace(/"/g, '\'').replace(/\\\\/g, '/'),
      src_folders: JSON.stringify(src_folders).replace(/"/g, '\'').replace(/\\\\/g, '/'),
      page_objects_path: JSON.stringify(page_objects_path).replace(/"/g, '\'').replace(/\\\\/g, '/'),
      custom_commands_path: JSON.stringify(custom_commands_path).replace(/"/g, '\'').replace(/\\\\/g, '/'),
      custom_assertions_path: JSON.stringify(custom_assertions_path).replace(/"/g, '\'').replace(/\\\\/g, '/'),
      feature_path: feature_path.replace(/\\/g, '/'),
      client_id: this.client_id,
      dotExe: process.platform === 'win32' ? '.exe' : '',
      answers
    });

    rendered = stripControlChars(rendered);

    try {
      fs.writeFileSync(configDestPath, rendered, {encoding: 'utf-8'});

      Logger.info(`${colors.green(symbols().ok + ' Success!')} Configuration file generated at: "${configDestPath}".`);

      if (this.otherInfo.nonDefaultConfigName) {
        Logger.info(`To use this configuration file, run the tests using ${colors.magenta('--config')} flag.`);
      }
      // Add a newline
      Logger.info();

      return true;
    } catch (err) {
      Logger.error('Failed to generate Nightwatch config.');
      Logger.error(
        'Please run the init command again, or a config file will be auto-generated when you run your first test.'
      );

      return false;
    }
  }

  identifyDriversToInstall(answers: ConfigGeneratorAnswers): string[] {
    const drivers: string[] = [];

    const localAppTestingOnAndroid = (isAppTestingSetup(answers) && answers.backend !== 'remote' &&
      answers.mobilePlatform && ['android', 'both'].includes(answers.mobilePlatform));

    if (localAppTestingOnAndroid) {
      drivers.push('uiautomator2');
    }

    const localWebTestingOnSafari = answers.browsers?.includes('safari') || answers.mobileBrowsers?.includes('safari');
    const localAppTestingOnIos = (isAppTestingSetup(answers) && answers.backend !== 'remote' &&
      answers.mobilePlatform && ['ios', 'both'].includes(answers.mobilePlatform));

    if (localWebTestingOnSafari || localAppTestingOnIos) {
      drivers.push('safaridriver');
    }
    if (localAppTestingOnIos) {
      drivers.push('xcuitest');
    }

    return drivers;
  }

  async installDrivers(driversToInstall: string[]) {
    if (driversToInstall.includes('safaridriver')) {
      Logger.info('Installing the following webdrivers:\n- safaridriver\n');

      // remove safaridriver from driversToInstall
      const safaridriverIndex = driversToInstall.indexOf('safaridriver');
      if (safaridriverIndex > -1) {
        driversToInstall.splice(safaridriverIndex, 1);
      }

      try {
        const answers = await prompt([
          {
            type: 'list',
            name: 'safaridriver',
            message: 'Enable safaridriver (requires sudo password, skip if already enabled)?',
            choices: [
              {name: 'Yes', value: true},
              {name: 'No, skip for now', value: false}
            ],
            default: 1
          }
        ]);

        if (answers.safaridriver) {
          Logger.info();
          Logger.info('Enabling safaridriver...');
          execSync('sudo safaridriver --enable', {
            stdio: ['inherit', 'pipe', 'inherit'],
            cwd: this.rootDir
          });
          Logger.info(colors.green('Done!'), '\n');
        } else {
          Logger.info('Please run \'sudo safaridriver --enable\' command to enable safaridriver later.\n');
        }
      } catch (err) {
        Logger.error('Failed to enable safaridriver. Please run \'sudo safaridriver --enable\' later.\n');
      }
    }

    if (!driversToInstall.length) {
      return;
    }

    Logger.info('Installing the following appium drivers:');
    for (const driver of driversToInstall) {
      Logger.info(`- ${driver}`);
    }
    Logger.info();

    const appiumDrivers: { [key: string]: string } = {
      uiautomator2: 'Android',
      xcuitest: 'iOS'
    };

    for (const driver of driversToInstall) {
      if (driver in appiumDrivers) {
        Logger.info(`Installing appium driver for ${appiumDrivers[driver]} (${driver})...`);
        try {
          execSync(`npx appium driver install ${driver}`, {
            stdio: ['inherit', 'pipe', 'inherit'],
            cwd: this.rootDir
          });
          Logger.info(colors.green('Done!'), '\n');
        } catch (err) {
          Logger.error(`Failed to install ${driver}.\n`);
        }
      }
    }
  }

  createTestLocation(testsLocation: string) {
    try {
      fs.mkdirSync(path.join(this.rootDir, testsLocation), {recursive: true});
      // eslint-disable-next-line
    } catch (err) {}
  }

  copyCucumberExamples(examplesLocation: string) {
    // If the featurePath (part of examplesLocation) contains **, no way of knowing where to put
    // example feature files (maybe in the most outside folder by creating a new example dir?)
    // Skipping all paths with '*' for now.
    if (examplesLocation.includes('*')) {
      return;
    }

    Logger.info('Generating example for CucumberJS...');
    this.otherInfo.cucumberExamplesAdded = true;

    const exampleDestPath = path.join(this.rootDir, examplesLocation);
    if (fs.existsSync(exampleDestPath)) {
      Logger.info(`Example already exists at '${examplesLocation}'. Skipping...`, '\n');

      return;
    }
    fs.mkdirSync(exampleDestPath, {recursive: true});

    const nightwatchModulePath = path.dirname(require.resolve('nightwatch/package.json', {paths: [this.rootDir]}));
    const exampleSrcPath = path.join(nightwatchModulePath, 'examples', 'cucumber-js', 'features');

    copy(exampleSrcPath, exampleDestPath);
    Logger.info(
      `${colors.green(symbols().ok + ' Success!')} Generated an example for CucumberJS at "${examplesLocation}".\n`
    );
  }

  copyExamples(examplesLocation: string, typescript: boolean) {
    Logger.info('Generating example files...');

    const examplesDestPath = path.join(this.rootDir, examplesLocation);  // this is different from this.otherInfo.examplesJsSrc
    try {
      fs.mkdirSync(examplesDestPath, {recursive: true});
      // eslint-disable-next-line
    } catch (err) {}

    const examplesDestFiles = fs.readdirSync(examplesDestPath);

    if ((typescript && examplesDestFiles.length > 1) || (!typescript && examplesDestFiles.length > 0)) {
      Logger.info(`Examples already exists at '${examplesLocation}'. Skipping...`, '\n');

      return;
    }

    let examplesSrcPath: string;
    if (typescript) {
      examplesSrcPath = path.join(__dirname, '..', 'assets', 'ts-examples');
    } else {
      examplesSrcPath = path.join(__dirname, '..', 'assets', 'js-examples-new');
    }

    copy(examplesSrcPath, examplesDestPath);

    Logger.info(
      `${colors.green(symbols().ok + ' Success!')} Generated some example files at '${examplesLocation}'.\n`
    );
  }

  copyTemplates(examplesLocation: string) {
    Logger.info('Generating template files...');

    // Set templatesGenerated to true even if skipped, since in that case
    // templates are already present.
    this.otherInfo.templatesGenerated = true;

    const templatesLocation = path.join(examplesLocation, 'templates');
    const templatesDestPath = path.join(this.rootDir, templatesLocation);

    try {
      fs.mkdirSync(templatesDestPath, {recursive: true});
      // eslint-disable-next-line
    } catch (err) {}

    if (fs.readdirSync(templatesDestPath).length) {
      Logger.info(`Templates already exists at '${templatesLocation}'. Skipping...`, '\n');

      return;
    }

    const templatesSrcPath = path.join(__dirname, '..', 'assets', 'templates');
    
    copy(templatesSrcPath, templatesDestPath);

    Logger.info(
      `${colors.green(symbols().ok + ' Success!')} Generated some templates files at '${templatesLocation}'.\n`
    );
  }

  postSetupInstructions(answers: ConfigGeneratorAnswers, mobileHelperResult: MobileHelperResult) {
    // Instructions for setting host, port, username and password for remote.
    if (answers.backend && ['remote', 'both'].includes(answers.backend)) {
      Logger.info(colors.red('IMPORTANT'));
      if (answers.cloudProvider === 'other') {
        let configFileName = this.otherInfo.usingESM ? 'nightwatch.conf.cjs' : 'nightwatch.conf.js';
        if (this.otherInfo.nonDefaultConfigName) {
          configFileName = this.otherInfo.nonDefaultConfigName;
        }
        Logger.info(
          `To run tests on your remote device, please set the ${colors.magenta('host')} and ${colors.magenta('port')} property in your ${configFileName} file.` 
        );
        Logger.info('These can be located at:');
        Logger.info(
          `{\n  ...\n  "test_settings": {\n    ...\n    "${answers.remoteName}": {\n      "selenium": {\n        ${colors.cyan(
            '"host":')}\n        ${colors.cyan('"port":')}\n      }\n    }\n  }\n}`,
          '\n'
        );

        Logger.info(
          'Please set the credentials (if any) required to run tests on your cloud provider or remote selenium-server, by setting the below env variables:'
        );
      } else {
        Logger.info(
          'Please set the credentials required to run tests on your cloud provider, by setting the below env variables:'
        );
      }

      Logger.info(`- ${colors.cyan(answers.remoteEnv?.username as string)}`);
      Logger.info(`- ${colors.cyan(answers.remoteEnv?.access_key as string)}`);
      Logger.info('(.env files are also supported)', '\n');
    }
    Logger.info();

    const relativeToRootDir = path.relative(process.cwd(), this.rootDir) || '.';

    // For now the templates added only for JS
    if (this.otherInfo.templatesGenerated) {
      Logger.info(colors.green('📃 TEMPLATE TESTS'), '\n');
      Logger.info('To get started, checkout the following templates. Skip/delete them if you are an experienced user.');
      Logger.info(colors.cyan(`  1. Title Assertion (${path.join(relativeToRootDir, answers.examplesLocation || '', 'templates', 'titleAssertion.js')})`));
      Logger.info(colors.cyan(`  2. Login (${path.join(relativeToRootDir, answers.examplesLocation || '', 'templates', 'login.js')})`));
      Logger.info();
    }

    Logger.info(colors.green('✨ SETUP COMPLETE'));
    execSync('npx nightwatch --version', {
      stdio: 'inherit',
      cwd: this.rootDir
    });

    // Join Discord and GitHub
    Logger.info('💬 Join our Discord community to find answers to your issues or queries. Or just join and say hi.');
    Logger.info(colors.cyan('   https://discord.gg/SN8Da2X'), '\n');
  
    let directoryChange = '';
    if (this.rootDir !== process.cwd()) {
      directoryChange = `cd ${relativeToRootDir}\n  `;
    }

    let configFlag = '';
    if (this.otherInfo.nonDefaultConfigName) {
      configFlag = ` --config ${this.otherInfo.nonDefaultConfigName}`;
    }

    if (isWebTestingSetup(answers) && !this.options?.mobile) {
      // web-testing setup, with no `--mobile` flag (testing only on desktop browsers).

      Logger.info(colors.green('🚀 RUN EXAMPLE TESTS'), '\n');

      let envFlag = '';
      if (answers.backend === 'remote') {
        envFlag = ` --env ${answers.remoteName}.${answers.defaultBrowser}`;
      }

      if (answers.runner === Runner.Cucumber) {
        Logger.info('To run your tests with CucumberJS, simply run:');
        Logger.info(colors.cyan(`  ${directoryChange}npx nightwatch${envFlag}${configFlag}`), '\n');

        if (this.otherInfo.cucumberExamplesAdded) {
          Logger.info('To run an example test with CucumberJS, run:');
          Logger.info(colors.cyan(`  ${directoryChange}npx nightwatch ${answers.examplesLocation}${envFlag}${configFlag}`), '\n');
        }

        Logger.info('For more details on using CucumberJS with Nightwatch, visit:');
        Logger.info(
          colors.cyan('  https://nightwatchjs.org/guide/third-party-runners/cucumberjs-nightwatch-integration.html')
        );
      } else if (answers.addExamples) {
        if (answers.language === 'ts') {
          Logger.info('To run all examples, run:');
          Logger.info(
            colors.cyan(`  ${directoryChange}npx nightwatch .${path.sep}${this.otherInfo.examplesJsSrc}${envFlag}${configFlag}\n`)
          );

          Logger.info('To run a single example (github.ts), run:');
          Logger.info(
            colors.cyan(
              `  ${directoryChange}npx nightwatch .${path.sep}${path.join(
                this.otherInfo.examplesJsSrc || '',
                'github.ts'
              )}${envFlag}${configFlag}\n`
            )
          );
        } else {
          Logger.info('To run all examples, run:');
          Logger.info(
            colors.cyan(
              `  ${directoryChange}npx nightwatch .${path.sep}${path.join(
                this.otherInfo.examplesJsSrc || '',
                EXAMPLE_TEST_FOLDER
              )}${envFlag}${configFlag}\n`
            )
          );

          Logger.info('To run a single example (ecosia.js), run:');
          Logger.info(
            colors.cyan(
              `  ${directoryChange}npx nightwatch .${path.sep}${path.join(
                this.otherInfo.examplesJsSrc || '',
                EXAMPLE_TEST_FOLDER,
                'basic',
                'ecosia.js'
              )}${envFlag}${configFlag}\n`
            )
          );
        }
      } else {
        Logger.info(`A few examples are available at '${path.join('node_modules', 'nightwatch', 'examples')}'.\n`);

        Logger.info('To run a single example (ecosia.js), try:');
        Logger.info(
          colors.cyan(
            `  ${directoryChange}npx nightwatch ${path.join(
              'node_modules',
              'nightwatch',
              'examples',
              'tests',
              'ecosia.js'
            )}${envFlag}${configFlag}`
          ),
          '\n'
        );

        Logger.info('To run all examples, try:');
        Logger.info(
          colors.cyan(`  ${directoryChange}npx nightwatch ${path.join('node_modules', 'nightwatch', 'examples')}${envFlag}${configFlag}`),
          '\n'
        );
      }
    }

    if (answers.seleniumServer) {
      Logger.info('[Selenium Server]\n');
      if (this.otherInfo.javaNotInstalled) {
        Logger.info(
          'Java Development Kit (minimum v7) is required to run selenium-server locally. Download from here:'
        );
        Logger.info(colors.cyan('  https://www.oracle.com/technetwork/java/javase/downloads/index.html'), '\n');
      }

      Logger.info('To run tests on your local selenium-server, use command:');
      Logger.info(colors.cyan(`  ${directoryChange}npx nightwatch --env selenium_server${configFlag}`), '\n');
    }

    // MOBILE WEB AND APP TESTS
    postMobileSetupInstructions(answers, mobileHelperResult, configFlag, this.rootDir, this.otherInfo.examplesJsSrc);
  }

  postConfigInstructions(answers: ConfigGeneratorAnswers) {
    if (answers.seleniumServer && this.otherInfo.javaNotInstalled) {
      Logger.info('Java Development Kit (minimum v7) is required to run selenium-server locally. Download from here:');
      Logger.info(colors.cyan('  https://www.oracle.com/technetwork/java/javase/downloads/index.html'), '\n');
    }

    Logger.info('Happy Testing!');
  }

  pushAnonymousMetrics(answers: ConfigGeneratorAnswers) {
    const GA_API_KEY = 'XuPojOTwQ6yTO758EV4hBg';
    const GA_TRACKING_ID = 'G-DEKPKZSLXS';

    const payload = {
      'client_id': this.client_id,
      'non_personalized_ads': true,
      'timestamp_micros': new Date().getTime() * 1000,
      'events': {
        'name': 'nw_install',
        'params': {
          browsers: answers.browsers?.join(','),
          cloud_provider: answers.cloudProvider,
          language: answers.language,
          runner: answers.runner,
          add_example: answers.addExamples,
          testing_type: answers.testingType?.join(','),
          is_mobile: answers.mobile,
          mobile_platform: answers.mobilePlatform,
          ui_framework: answers.uiFramework
        }
      }
    };

    const data = JSON.stringify(payload);

    const options = {
      hostname: 'www.google-analytics.com',
      port: 443,
      path: `/mp/collect?api_secret=${GA_API_KEY}&measurement_id=${GA_TRACKING_ID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options);
    req.write(data);
    req.on('error', () => {
      // ignore connection errors
    });
    req.end();
  }
}
