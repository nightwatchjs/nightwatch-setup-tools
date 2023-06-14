import {execSync} from 'child_process';
import fs from 'node:fs';
import path from 'path';
import colors from 'ansi-colors';
import boxen from 'boxen';
import Logger from './logger';
import {ConfigGeneratorAnswers, MobileHelperResult} from './interfaces';
import {copy, downloadWithProgressBar} from './utils';
import DOWNLOADS from './downloads.json';
import {EXAMPLE_TEST_FOLDER, Runner, isAppTestingSetup, isLocalMobileTestingSetup, isRemoteMobileTestingSetup} from './constants';

export function installPackages(packagesToInstall: string[], rootDir: string): void {
  if (packagesToInstall.length === 0) {
    return;
  }

  Logger.info('Installing the following packages:');
  for (const pack of packagesToInstall) {
    Logger.info(`- ${pack}`);
  }
  Logger.info();

  for (const pack of packagesToInstall) {
    Logger.info(`Installing ${colors.green(pack)}`);

    try {
      execSync(`npm install ${pack} --save-dev`, {
        stdio: ['inherit', 'pipe', 'inherit'],
        cwd: rootDir
      });
      Logger.info(colors.green('Done!'), '\n');
    } catch (err) {
      Logger.error(`Failed to install ${pack}. Please run 'npm install ${pack} --save-dev' later.\n`);
    }
  }
}

export async function copyAppTestingExamples(answers: ConfigGeneratorAnswers, rootDir: string) {
  const examplesLocation = answers.examplesLocation || '';
  const lang = answers.language || 'js';
  
  const mobilePlatforms: ('android' | 'ios')[] = [];
  if (answers.mobilePlatform) {
    if (answers.mobilePlatform === 'both') {
      mobilePlatforms.push('android', 'ios');
    } else {
      mobilePlatforms.push(answers.mobilePlatform);
    }
  }

  Logger.info('Generating mobile-app example tests...\n');
  
  const examplesDestPath = path.join(
    rootDir,
    examplesLocation,
    lang === 'js' ? EXAMPLE_TEST_FOLDER : '',
    'mobile-app-tests'
  );
  const appDestPath = path.join(rootDir, examplesLocation, 'sample-apps');

  try {
    fs.mkdirSync(examplesDestPath, {recursive: true});
    fs.mkdirSync(appDestPath, {recursive: true});
    // eslint-disable-next-line
    } catch (err) {}

  for (const platform of mobilePlatforms) {
    const examplesSrcPath = path.join(__dirname, '..', 'assets', 'mobile-app-tests', `${platform}-${lang}`);

    copy(examplesSrcPath, examplesDestPath);

    Logger.info(`Downloading sample ${platform} app...`);
    const downloadUrl = DOWNLOADS.wikipedia[platform];
    const downloaded = await downloadWithProgressBar(downloadUrl, appDestPath);
    if (!downloaded) {
      Logger.info(`${colors.red('Download Failed!')} You can download it from ${downloadUrl} and save it to '${path.join(
        examplesLocation, 'sample-apps'
      )}' inside your project root dir.\n`);
    }
  }
}

export function postMobileSetupInstructions(answers: ConfigGeneratorAnswers,
  mobileHelperResult: MobileHelperResult,
  configFlag: string,
  rootDir: string,
  examplesJsSrc?: string,
  isInitiation = true) {
  const cucumberExample = `npx nightwatch${configFlag}`;
  const relativeToRootDir = path.relative(process.cwd(), rootDir) || '.';

  const mobileTsExample = `npx nightwatch .${path.sep}${path.join(
    examplesJsSrc || '',
    'github.ts'
  )}${configFlag}`;

  const mobileJsExample = `npx nightwatch .${path.sep}${path.join(
    examplesJsSrc || '',
    EXAMPLE_TEST_FOLDER,
    'basic',
    'ecosia.js'
  )}${configFlag}`;

  const mobileExampleCommand = (envFlag: string) => {
    if (answers.runner === Runner.Cucumber) {
      return `${cucumberExample}${envFlag}`;
    }

    if (answers.language === 'ts') {
      return `${mobileTsExample}${envFlag}`;
    }

    return `${mobileJsExample}${envFlag}`;
  };

  const appTsExample = (mobilePlatform: string) => {
    return `npx nightwatch .${path.sep}${path.join(
      examplesJsSrc || '',
      'mobile-app-tests',
      `wikipedia-${mobilePlatform}.ts`
    )}${configFlag}`;
  };

  const appJsExample = (mobilePlatform: string) => {
    return `npx nightwatch .${path.sep}${path.join(
      examplesJsSrc || '',
      EXAMPLE_TEST_FOLDER,
      'mobile-app-tests',
      `wikipedia-${mobilePlatform}.js`
    )}${configFlag}`;
  };

  const appExampleCommand = (envFlag: string, mobilePlatform: string) => {
    // no cucumber app-tests for now
    if (answers.language === 'ts') {
      return `${appTsExample(mobilePlatform)}${envFlag}`;
    }

    return `${appJsExample(mobilePlatform)}${envFlag}`;
  };

  const cucumberAppTestingOnly = answers.runner === Runner.Cucumber && isAppTestingSetup(answers) && !answers.mobile;
  let exampleCommandsShared = false;

  if (isLocalMobileTestingSetup(answers) && answers.mobilePlatform && !cucumberAppTestingOnly) {
    exampleCommandsShared = true;

    Logger.info(colors.green('🚀 RUN MOBILE EXAMPLE TESTS'), '\n');

    if (['android', 'both'].includes(answers.mobilePlatform)) {
      const errorHelp = 'Please go through the setup logs above to know the actual cause of failure.\n\nOr, re-run the following commands:';

      const appiumFlag = isAppTestingSetup(answers) ? ' --appium' : '';
      const setupMsg = `  To setup Android, run: ${colors.gray.italic('npx @nightwatch/mobile-helper android' + appiumFlag)}\n` +
          `  For Android help, run: ${colors.gray.italic('npx @nightwatch/mobile-helper android --help')}`;

      const browsers = answers.mobileBrowsers?.filter((browser) => ['chrome', 'firefox'].includes(browser)) || [];

      const realAndroidTestCommand = (newline = '') => {
        const commands: string[] = [];
        commands.push('▶ To run an example test on Real Android device');
        commands.push('  * Make sure your device is connected with USB Debugging turned on.');
        commands.push('  * Make sure required browsers are installed.');

        if (answers.mobile && browsers.length) {
          commands.push('  For mobile web tests, run:');
          for (const browser of browsers) {
            const envFlag = ` --env android.real.${browser}`;
            commands.push(`    ${colors.cyan(mobileExampleCommand(envFlag))}${newline}`);
          }
        }

        if (isAppTestingSetup(answers) && answers.runner !== Runner.Cucumber) {
          commands.push('  For mobile app tests, run:');
          const envFlag = ' --env app.android.real';
          commands.push(`    ${colors.cyan(appExampleCommand(envFlag, 'android'))}${newline}`);
        }

        return commands.join('\n');
      };

      const emulatorAndroidTestCommand = (newline = '') => {
        const commands: string[] = [];
        commands.push('▶ To run an example test on Android Emulator');

        if (answers.mobile && browsers.length) {
          commands.push('  For mobile web tests, run:');
          for (const browser of browsers) {
            const envFlag = ` --env android.emulator.${browser}`;
            commands.push(`    ${colors.cyan(mobileExampleCommand(envFlag))}${newline}`);
          }
        }

        if (isAppTestingSetup(answers) && answers.runner !== Runner.Cucumber) {
          commands.push('  For mobile app tests, run:');
          const envFlag = ' --env app.android.emulator';
          commands.push(`    ${colors.cyan(appExampleCommand(envFlag, 'android'))}${newline}`);
        }

        return commands.join('\n');
      };

      const testCommands = `Once setup is complete...\n\n${realAndroidTestCommand()}\n\n${emulatorAndroidTestCommand()}`;

      if (!mobileHelperResult.android) {
        // mobileHelperResult.android is undefined or false
        Logger.error(
          boxen(`${colors.red(
            'Android setup failed...'
          )}\n\n${errorHelp}\n${setupMsg}\n\n${testCommands}`, {padding: 1})
        );
      } else if (mobileHelperResult.android === true) {
        // do nothing (command passed but verification/setup not initiated)
        // true is returned in cases of --help command.
      } else if (mobileHelperResult.android.status === false) {
        if (mobileHelperResult.android.setup) {
          Logger.error(
            boxen(`${colors.red(
              'Android setup failed...'
            )}\n\n${errorHelp}\n${setupMsg}\n\n${testCommands}`, {padding: 1})
          );
        } else {
          Logger.info(
            boxen(`${colors.red(
              'Android setup skipped...'
            )}\n\n${setupMsg}\n\n${testCommands}`, {padding: 1})
          );
        }
      } else {
        // mobileHelperResult.android.status is true.
        if (rootDir !== process.cwd()) {
          Logger.info('First, change directory to the root dir of your project:');
          Logger.info(colors.cyan(`  cd ${relativeToRootDir}`), '\n');
        }

        if (['real', 'both'].includes(mobileHelperResult.android.mode)) {
          Logger.info(realAndroidTestCommand(), '\n');
        }

        if (['emulator', 'both'].includes(mobileHelperResult.android.mode)) {
          Logger.info(emulatorAndroidTestCommand(), '\n');
        }
      }
    }

    if (['ios', 'both'].includes(answers.mobilePlatform)) {
      const setupHelp = 'Please follow the guide above to complete the setup.\n\nOr, re-run the following commands:';

      const setupCommand = `  For iOS setup, run: ${colors.gray.italic('npx @nightwatch/mobile-helper ios --setup')}\n` +
          `  For iOS help, run: ${colors.gray.italic('npx @nightwatch/mobile-helper ios --help')}`;

      const safariBrowserPresent = answers.mobileBrowsers?.includes('safari');

      const realIosTestCommand = () => {
        const commands: string[] = [];
        commands.push('▶ To run an example test on real iOS device');

        if (answers.mobile && safariBrowserPresent) {
          commands.push('  For mobile web tests, run:');
          commands.push(`    ${colors.cyan(mobileExampleCommand(' --env ios.real.safari'))}`);
        }

        if (isAppTestingSetup(answers) && answers.runner !== Runner.Cucumber) {
          commands.push('  For mobile app tests, run:');
          commands.push(`    ${colors.cyan(appExampleCommand(' --env app.ios.real', 'ios'))}`);
        }

        return commands.join('\n');
      };

      const simulatorIosTestCommand = () => {
        const commands: string[] = [];
        commands.push('▶ To run an example test on iOS simulator');

        if (answers.mobile && safariBrowserPresent) {
          commands.push('  For mobile web tests, run:');
          commands.push(`    ${colors.cyan(mobileExampleCommand(' --env ios.simulator.safari'))}`);
        }

        if (isAppTestingSetup(answers) && answers.runner !== Runner.Cucumber) {
          commands.push('  For mobile app tests, run:');
          commands.push(`    ${colors.cyan(appExampleCommand(' --env app.ios.simulator', 'ios'))}`);
        }

        return commands.join('\n');
      };

      const testCommand = `After completing the setup...\n\n${realIosTestCommand()}\n\n${simulatorIosTestCommand()}`;

      if (!mobileHelperResult.ios) {
        Logger.error(
          boxen(`${colors.red(
            'iOS setup failed...'
          )}\n\n${setupCommand}\n\n${testCommand}`, {padding: 1})
        );
      } else if (typeof mobileHelperResult.ios === 'object') {
        if (mobileHelperResult.ios.real) {
          Logger.info(realIosTestCommand(), '\n');
        }

        if (mobileHelperResult.ios.simulator) {
          Logger.info(simulatorIosTestCommand(), '\n');
        }

        if (!mobileHelperResult.ios.real || !mobileHelperResult.ios.simulator) {
          Logger.error(
            boxen(`${colors.yellow(
              'iOS setup incomplete...'
            )}\n\n${setupHelp}\n${setupCommand}\n\n${testCommand}`, {padding: 1})
          );
        }
      }
    }
  }

  if (isInitiation) {
    // eslint-disable-next-line no-console
    console.log('Initializing nightwatch');
  }

  if (!exampleCommandsShared && isRemoteMobileTestingSetup(answers) && answers.cloudProvider === 'browserstack') {
    // no other test run commands are printed and remote with mobile (web/app) is selected.

    // TODO: Add support for testing native apps on BrowserStack and then remove the below code.
    if (!answers.mobile) {
      return;
    }

    Logger.info(colors.green('🚀 RUN MOBILE EXAMPLE TESTS ON CLOUD'), '\n');
    if (rootDir !== process.cwd()) {
      Logger.info('First, change directory to the root dir of your project:');
      Logger.info(colors.cyan(`  cd ${relativeToRootDir}`), '\n');
    }

    const chromeEnvFlag = ' --env browserstack.android.chrome';
    const safariEnvFlag = ' --env browserstack.ios.safari';

    if (answers.runner === Runner.Cucumber) {
      Logger.info('To run your tests with CucumberJS, simply run:');
      Logger.info('  Chrome: ', colors.cyan(`${cucumberExample}${chromeEnvFlag}`), '\n');
      Logger.info('  Safari: ', colors.cyan(`${cucumberExample}${safariEnvFlag}`), '\n');
    } else if (answers.addExamples) {
      if (answers.language === 'ts') {
        Logger.info('To run an example test (github.ts), run:');
        Logger.info('  Chrome: ', colors.cyan(`${mobileTsExample}${chromeEnvFlag}`), '\n');
        Logger.info('  Safari: ', colors.cyan(`${mobileTsExample}${safariEnvFlag}`), '\n');
      } else {
        Logger.info('To run an example test (ecosia.js), run:');
        Logger.info('  Chrome: ', colors.cyan(`${mobileJsExample}${chromeEnvFlag}`), '\n');
        Logger.info('  Safari: ', colors.cyan(`${mobileJsExample}${safariEnvFlag}`), '\n');
      }
    }
  }
}