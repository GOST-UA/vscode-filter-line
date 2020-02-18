'use strict';
import * as vscode from 'vscode';
import { FilterLineBase } from './filter_base';

class FilterLineByInputString extends FilterLineBase {
    private _inputstring?: string;
    private readonly HIST_KEY = 'inputStr';

    public notcontain = false;

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

        this.logger.appendLine('User input: ' + usrChoice);
        this.addToHistory(this.HIST_KEY, usrChoice);

        this._inputstring = usrChoice;
        callback(true);
    }

    protected matchLine(line: string): string | undefined {
        if (this._inputstring === undefined) {
            return undefined;
        }
        if (this.notcontain) {
            if (line.indexOf(this._inputstring) === -1) {
                return line;
            }
        } else {
            if (line.indexOf(this._inputstring) !== -1) {
                return line;
            }
        }
        return undefined;
    }

    dispose() {
    }

}

export { FilterLineByInputString};
