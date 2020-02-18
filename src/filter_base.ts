'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
// import * as vscode from 'vscode';
import {Uri, window, QuickPickItem, OutputChannel, TextDocument, workspace, Position} from 'vscode';
import {ExtensionContext, commands} from 'vscode';
import fs = require('fs');
import path = require('path');
import os = require('os');
import {promisify} from 'util';
import stream = require('stream');

const pipeline = promisify(stream.pipeline);
import { FilterStream, TextDocumentReadStream, statAsync, moveAsync, unlinkAsync } from './util';


class FilterItem implements QuickPickItem {
    label: string;
    description = '';
    detail: string;

    constructor(public pattern: string) {
        this.label = pattern;
        this.detail = '';
    }
}

class Filter {
    protected readonly TAIL = 'filterline';

    constructor(protected fromUri: Uri,
                protected filterCallback: (line: string) => string | boolean | undefined,
                protected logger: OutputChannel) {
    }

    public async process(): Promise<Uri> {
        let ext = path.extname(this.fromUri.path);
        const timestamp = new Date().getTime().toString();
        let outBase = '';
        if (this.fromUri.scheme !== 'file') {
            outBase = this.fromUri.path;
            ext = (ext === '') ? '.txt' : ext;
        } else {
            outBase = this.fromUri.fsPath.split(path.sep).slice(-1)[0].split('.').slice(0, -1).join('.');
        }

        let outPath = `${outBase}.${this.TAIL}-${timestamp}${ext}`;
        outPath = `${os.tmpdir()}${path.sep}${outPath}`;

        await pipeline(
            this.createInputStream(),
            new FilterStream(this.filterCallback),
            fs.createWriteStream(outPath)
        );

        return Uri.parse(`file:${outPath}`);
    }

    protected createInputStream(): stream.Readable {
        if (this.fromUri.scheme === 'file') {
            const doc = this.findOpenedDoc();
            if (doc !== undefined && doc.isDirty) {
                return new TextDocumentReadStream(doc, {encoding: 'utf-8'});
            }

            return fs.createReadStream(this.fromUri.fsPath, {encoding: 'utf-8'});
        } else {
            const doc = this.findOpenedDoc();

            if (doc === undefined) {
                this.logger.appendLine('Unable to find open document for provided URI');
                throw Error('TextDocument not found');
            }

            return new TextDocumentReadStream(doc, {encoding: 'utf-8'});
        }
    }

    protected findOpenedDoc(): TextDocument | undefined {
        return workspace.textDocuments.find(el => el.uri.path === this.fromUri.path);
    }
}

class FilterLineBase {
    protected ctx: ExtensionContext;
    private history: any;
    protected readonly NEW_PATTERN_CHOICE = 'New pattern...';
    protected readonly LARGE_MODE_THR = (30 * 1024 * 1024);

    constructor(context: ExtensionContext, protected logger: OutputChannel) {
        this.ctx = context;
        this.history = this.ctx.globalState.get('history', {});

        this.logger.appendLine(`Temp path: ${os.tmpdir()}`);
    }

    protected getHistory(): any {
        return this.history;
    }

    protected async updateHistory(hist: any) {
        this.history = hist;
        await this.ctx.globalState.update('history', hist);
    }

    protected getHistoryMaxSize(): number {
        return workspace.getConfiguration('filter-line').get('historySize', 10);
    }

    protected async addToHistory(key: string, newEl: string) {
        if (this.history[key] === undefined) {
            this.logger.appendLine(`History doesn't contain '${key}' field`);
            return;
        }

        const maxSz = this.getHistoryMaxSize();
        if (this.history[key].length >= maxSz) {
            this.history[key].splice(maxSz);
        }

        const idx = this.history[key].indexOf(newEl);

        if (idx === -1) {
            this.history[key].unshift(newEl);
            await this.ctx.globalState.update('history', this.history);
        } else {
            this.history[key].splice(idx, 1);
            this.history[key].unshift(newEl);
        }
    }

    protected async showHistoryPick(key: string): Promise<string> {
        return new Promise((resolve) => {
            const histPick = window.createQuickPick<FilterItem>();
            histPick.placeholder = 'Select (or type) filter pattern';
            histPick.canSelectMany = false;
            histPick.items = ['', ...this.history[key]].map((patt: string) => new FilterItem(patt));

            histPick.onDidAccept(() => {
                resolve(histPick.activeItems[0].pattern);
                histPick.hide();
            });

            histPick.onDidChangeValue(() => {
                if (this.history[key].indexOf(histPick.value) === -1) {
                    histPick.items = [histPick.value, ...this.history[key]].map((patt: string) => new FilterItem(patt));
                }
            });

            histPick.onDidHide(() => histPick.dispose());
            histPick.show();
        });
    }

    protected getSaveAfterFilteringFlag(): boolean {
        return workspace.getConfiguration('filter-line').get('saveAfterFiltering', false);
    }

    protected showInfo(text: string) {
        this.logger.appendLine(text);
        window.showInformationMessage(text);
    }
    protected showError(text: string) {
        this.logger.appendLine(text);
        window.showErrorMessage(text);
    }

    protected showWarning(text: string) {
        this.logger.appendLine(text);
        window.showWarningMessage(text);
    }

    protected getSourceUri(fileUri?: Uri): Uri | undefined {
        if (fileUri === undefined) {
            // Filtering was launched from command line
            const editor = window.activeTextEditor;
            if (!editor) {
                this.showError("No file selected or file is too large. For large files, use file's context menu. For more information please visit README");
                return undefined;
            }

            return editor.document.uri;
        } else {
            return fileUri;
        }
    }

    protected async filter_(uri: Uri) {
        const tmpPath = await (new Filter(uri, (line) => this.matchLine(line), this.logger)).process();

        const fInfo = await statAsync(tmpPath.fsPath);

        const largeModeFlag = fInfo.size > this.LARGE_MODE_THR;
        const saveFlag = this.getSaveAfterFilteringFlag();

        let dstPath = tmpPath;
        let processed = false;

        if (saveFlag) {
            if (uri.scheme !== 'file') {
                this.showWarning("Don't know where to save file. Saved into temporary folder");
            } else {
                const dstBase = tmpPath.fsPath.split(path.sep).slice(-1)[0];
                dstPath = Uri.parse(uri.fsPath.split(path.sep).slice(0, -1).join(path.sep) + path.sep + dstBase);
                try {
                    await moveAsync(tmpPath.fsPath, dstPath.fsPath);
                } catch (error) {
                    this.showError('Error occurred on save file to origin folder. Saved into temporary folder');
                    dstPath = tmpPath;
                }
            }
        } else {
            if (largeModeFlag) {
                this.showWarning('Filtered content is larger then Visual Studio Code limitations. Saved into temporary folder');
            } else {
                await commands.executeCommand('workbench.action.files.newUntitledFile');
                const editor = window.activeTextEditor;

                if (editor === undefined) {
                    throw Error('Text Editor does not open');
                }

                const readStream = fs.createReadStream(tmpPath.fsPath, {encoding: 'utf-8', highWaterMark: 100 * 1024});

                const doc = editor.document;

                try {
                    for await (const chunk of readStream) {
                        const pos = doc.validatePosition(new Position(doc.lineCount, 0));
                        await editor.edit(async edit => {
                            edit.insert(pos, chunk);
                        });
                    }

                    await unlinkAsync(tmpPath.fsPath);
                    processed = true;
                } catch (e) {
                    if (e.name !== undefined && e.name === 'DISPOSED') {
                        processed = true;
                    }
                }
            }
        }

        if (!processed) {
            const doc = await workspace.openTextDocument(dstPath);
            await window.showTextDocument(doc);
        }

        this.showInfo('Filtering completed :)');
    }

    protected matchLine(line: string): string | undefined {
        return undefined;
    }

    protected prepare(callback: (succeed: boolean) => void) {
        callback(true);
    }

    public filter(filePath?: Uri) {
        const srcUri =this.getSourceUri(filePath);

        if (srcUri === undefined) {
            return;
        }

        this.logger.appendLine('will filter file: ' + srcUri.path);

        this.prepare(async (succeed) => {
            this.logger.appendLine(`Succeed ${succeed}`);
            if (!succeed) {
                return;
            }

            await this.filter_(srcUri);
        });
    }
}

export { FilterLineBase};
