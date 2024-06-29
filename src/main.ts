import * as core from '@actions/core';
import { S3Client } from '@aws-sdk/client-s3';
import * as fsAsync from 'fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { S3SyncClient } from 's3-sync-client';

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
    try {
        const s3Bucket = core.getInput('s3-bucket', { required: true });
        const s3Folder = core.getInput('s3-folder', { required: true });

        const s3Client = new S3Client();
        const syncClient = new S3SyncClient({ client: s3Client });

        const localFolder = path.resolve(process.cwd(), 'ssh');
        await syncClient.sync(`s3://${ s3Bucket }/${ s3Folder }`, localFolder);
        const sshConfigPath = path.resolve(localFolder, 'ssh.config');
        const sshRoot = fs.readFileSync(path.resolve(localFolder, 'ssh-root'), 'utf-8');
        const ansibleInventory = fs.readFileSync(path.resolve(localFolder,
            'ansible',
            'inventory.yaml'), 'utf-8').replaceAll(sshRoot, localFolder);
        fs.writeFileSync(sshConfigPath,
            fs.readFileSync(sshConfigPath, 'utf-8').replaceAll(sshRoot, localFolder));
        fixPrivateKeysPermissions(localFolder);
        core.exportVariable('ANSIBLE_INVENTORY', ansibleInventory);
        core.exportVariable('SSH_CONFIG_FOLDER', localFolder);
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed(`Unknown error of type '${ typeof error }${ typeof error === 'object'
                                                                       ? ` / ${ error!.constructor.name }`
                                                                       : '' }' occurred:\n\n${ error }`);
        }
    }
}

async function changePermissions(filePath: string) {
    try {
        await fsAsync.chmod(filePath, 0o600);
        console.log(`Permissions for ${ filePath } set to 600`);
    } catch (err) {
        console.error(`Error setting permissions for ${ filePath }:`, err);
    }
};

async function fixPrivateKeysPermissions(localFolder: string) {
    try {
        const files = await fsAsync.readdir(localFolder, { withFileTypes: true });

        for (const file of files) {
            const filePath = path.join(localFolder, file.name);

            if (file.isDirectory()) {
                await fixPrivateKeysPermissions(filePath);
            } else if (file.isFile() && file.name.endsWith('id_rsa')) {
                await changePermissions(filePath);
            }
        }
    } catch (err) {
        console.error(`Unable to scan directory: ${ err }`);
    }
}
