import {
	getCompositions,
	openBrowser,
	RenderInternals,
	renderStill,
} from '@remotion/renderer';
import chalk from 'chalk';
import {mkdirSync} from 'fs';
import path from 'path';
import {Config, Internals} from 'remotion';
import {getCliOptions} from './get-cli-options';
import {getCompositionId} from './get-composition-id';
import {handleCommonError} from './handle-common-errors';
import {initializeRenderCli} from './initialize-render-cli';
import {Log} from './log';
import {parsedCli} from './parse-command-line';
import {
	createOverwriteableCliOutput,
	makeRenderingProgress,
} from './progress-bar';
import {bundleOnCli} from './setup-cache';
import {RenderStep} from './step';
import {getUserPassedOutputLocation} from './user-passed-output-location';

export const still = async () => {
	const startTime = Date.now();
	const file = parsedCli._[1];
	const fullPath = RenderInternals.isServeUrl(file)
		? file
		: path.join(process.cwd(), file);

	await initializeRenderCli('still');

	const userOutput = path.resolve(process.cwd(), getUserPassedOutputLocation());

	if (userOutput.endsWith('.jpeg') || userOutput.endsWith('.jpg')) {
		Log.verbose(
			'Output file has a JPEG extension, therefore setting the image format to JPEG.'
		);
		Config.Rendering.setImageFormat('jpeg');
	}

	if (userOutput.endsWith('.png')) {
		Log.verbose(
			'Output file has a PNG extension, therefore setting the image format to PNG.'
		);
		Config.Rendering.setImageFormat('png');
	}

	const {
		inputProps,
		envVariables,
		quality,
		browser,
		imageFormat,
		stillFrame,
		browserExecutable,
	} = await getCliOptions({isLambda: false, type: 'still'});

	if (imageFormat === 'none') {
		Log.error(
			'No image format was selected - this is probably an error in Remotion - please post your command on Github Issues for help.'
		);
		process.exit(1);
	}

	if (imageFormat === 'png' && !userOutput.endsWith('.png')) {
		Log.warn(
			`Rendering a PNG, expected a .png extension but got ${userOutput}`
		);
	}

	if (
		imageFormat === 'jpeg' &&
		!userOutput.endsWith('.jpg') &&
		!userOutput.endsWith('.jpeg')
	) {
		Log.warn(
			`Rendering a JPEG, expected a .jpg or .jpeg extension but got ${userOutput}`
		);
	}

	const browserInstance = openBrowser(browser, {
		browserExecutable,
		shouldDumpIo: Internals.Logging.isEqualOrBelowLogLevel('verbose'),
	});

	mkdirSync(path.join(userOutput, '..'), {
		recursive: true,
	});

	const steps: RenderStep[] = [
		RenderInternals.isServeUrl(fullPath) ? null : ('bundling' as const),
		'rendering' as const,
	].filter(Internals.truthy);

	const urlOrBundle = RenderInternals.isServeUrl(fullPath)
		? Promise.resolve(fullPath)
		: await bundleOnCli(fullPath, steps);
	const {serveUrl, closeServer} = await RenderInternals.prepareServer(
		await urlOrBundle
	);

	const puppeteerInstance = await browserInstance;
	const comps = await getCompositions(serveUrl, {
		inputProps,
		puppeteerInstance,
		envVariables,
	});
	const compositionId = getCompositionId(comps);

	const composition = comps.find((c) => c.id === compositionId);
	if (!composition) {
		throw new Error(`Cannot find composition with ID ${compositionId}`);
	}

	const renderProgress = createOverwriteableCliOutput();
	const renderStart = Date.now();

	try {
		await renderStill({
			composition,
			frame: stillFrame,
			output: userOutput,
			serveUrl,
			quality,
			dumpBrowserLogs: Internals.Logging.isEqualOrBelowLogLevel('verbose'),
			envVariables,
			imageFormat,
			inputProps,
		});
	} catch (err) {
		Log.error();
		Log.error('The following error occured when rendering the still:');

		handleCommonError(err as Error);
		process.exit(1);
	}

	const closeBrowserPromise = puppeteerInstance.close();
	closeServer().catch((err) => {
		Log.error('Could not close web server', err);
	});
	renderProgress.update(
		makeRenderingProgress({
			frames: 1,
			concurrency: 1,
			doneIn: Date.now() - renderStart,
			steps,
			totalFrames: 1,
		})
	);

	Log.info(chalk.green('\nYour still frame is ready!'));

	const seconds = Math.round((Date.now() - startTime) / 1000);
	Log.info(
		[
			'- Total render time:',
			seconds,
			seconds === 1 ? 'second' : 'seconds',
		].join(' ')
	);
	Log.info('-', 'Output can be found at:');
	Log.info(chalk.cyan(`▶️ ${userOutput}`));
	await closeBrowserPromise;
};