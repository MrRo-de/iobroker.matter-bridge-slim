import { deleteFoldersRecursive, npmInstall, buildReact } from '@iobroker/build-tools';
import { cpSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const src = `${__dirname}/src-admin/`;

function clean(): void {
    deleteFoldersRecursive(`${__dirname}/admin`, [
        'admin-component-template.png',
        'jsonConfig.json',
        'matter-bridge-slim.png',
    ]);
    deleteFoldersRecursive(`${src}build`);
}

function copyAllFiles(): void {
    const buildDir = join(__dirname, 'src-admin', 'build');
    const targetDir = join(__dirname, 'admin', 'custom');

    for (const required of ['customComponents.js', 'mf-manifest.json']) {
        if (!fsExists(join(buildDir, required))) {
            throw new Error(`Admin-Builddatei fehlt: ${required}`);
        }
    }

    mkdirSync(targetDir, { recursive: true });

    const assetsSource = join(buildDir, 'assets');
    const assetsTarget = join(targetDir, 'assets');
    if (!fsExists(assetsSource)) {
        throw new Error('Admin-Asset-Verzeichnis fehlt: src-admin/build/assets');
    }
    cpSync(assetsSource, assetsTarget, { recursive: true });

    for (const file of ['customComponents.js', 'mf-manifest.json']) {
        copyFileSync(join(buildDir, file), join(targetDir, file));
    }

    for (const file of ['@mf-types.d.ts', '@mf-types.zip']) {
        const source = join(buildDir, file);
        if (fsExists(source)) copyFileSync(source, join(targetDir, file));
    }

    const i18nSource = join(__dirname, 'src-admin', 'src', 'i18n');
    const i18nTarget = join(targetDir, 'i18n');
    mkdirSync(i18nTarget, { recursive: true });
    for (const file of readdirSync(i18nSource)) {
        if (file.endsWith('.json')) {
            copyFileSync(join(i18nSource, file), join(i18nTarget, file));
        }
    }
}

function fsExists(path: string): boolean {
    try {
        require('node:fs').accessSync(path);
        return true;
    } catch {
        return false;
    }
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    npmInstall(src).catch((e: unknown) => console.error(`Cannot install npm: ${e as Error}`));
} else if (process.argv.includes('--2-build')) {
    buildReact(src, { vite: true }).catch((e: unknown) => console.error(`Cannot build: ${e as Error}`));
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles();
} else {
    clean();
    npmInstall(src)
        .then(() => buildReact(src, { vite: true }))
        .then(() => copyAllFiles())
        .catch((e: unknown) => {
            console.error(e);
            process.exit(2);
        });
}
