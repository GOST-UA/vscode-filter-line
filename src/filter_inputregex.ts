'use strict';
import * as vscode from 'vscode';
import {FilterLineBase} from './filter_base';

class FilterLineByInputRegex extends FilterLineBase {
    private _regex?: RegExp;
    private readonly HIST_KEY = 'inputRegex';

    public notmatch = false;

    constructor(context: vscode.ExtensionContext, logger: vscode.OutputChannel) {
        super(context, logger);

        const history = this.getHistory();
        if (history[this.HIST_KEY] === undefined) {
            history[this.HIST_KEY] = [];
            this.updateHistory(history);
        }
    }

    protected async prepare(callback: (succeed: boolean) => void) {
        const usrChoice: string = await this.showHistoryPick(this.HIST_KEY);

        if (usrChoice === '') {
            this.logger.appendLine('User input is an empty');
            callback(false);
            return;
        }

        try {
            this._regex = new RegExp(usrChoice);
        } catch (e) {
            this.logger.appendLine('Regex is incorrect: ' + e);
            this.showError('Regex incorrect :' + e);
            callback(false);
            return;
        }
        await this.addToHistory(this.HIST_KEY, usrChoice);
        callback(true);
    }

    protected matchLine(line: string): string | undefined {
        if (this._regex === undefined) {
            return undefined;
        }
        if (this.notmatch) {
            if (line.match(this._regex) === null) {
                return line;
            }
        } else {
            if (line.match(this._regex) !== null) {
                return line;
            }
        }
        return undefined;
    }

    dispose() {
    }
}

export { FilterLineByInputRegex};
