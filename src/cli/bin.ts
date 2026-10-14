import { run } from './main';

// `px-to-rem check | head` closes the pipe early; that is not an error.
for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EPIPE') {
            process.exit(process.exitCode ?? 0);
        }
        throw error;
    });
}

void run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: text => process.stdout.write(text + '\n'),
    err: text => process.stderr.write(text + '\n'),
    color: !!process.stdout.isTTY && !process.env.NO_COLOR,
}).then(code => {
    process.exitCode = code;
});
