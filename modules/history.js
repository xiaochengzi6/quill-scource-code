import Parchment from 'parchment';
import Quill from '../core/quill';
import Module from '../core/module';


class History extends Module {
  constructor(quill, options) {
    super(quill, options);
    this.lastRecorded = 0;
    this.ignoreChange = false;
    this.clear();

    // 去监听 quill 编辑器 修改
    this.quill.on(Quill.events.EDITOR_CHANGE, (eventName, delta, oldDelta, source) => {
      // 如果 修改不是文本修改，没有修改 就返回
      if (eventName !== Quill.events.TEXT_CHANGE || this.ignoreChange) return;
      // 如果是用户修改
      if (!this.options.userOnly || source === Quill.sources.USER) {
        this.record(delta, oldDelta);
      } else {
        // 否则 使用 transForm
        this.transform(delta);
      }
    });


    // 键绑定
    this.quill.keyboard.addBinding({ key: 'Z', shortKey: true }, this.undo.bind(this));
    this.quill.keyboard.addBinding({ key: 'Z', shortKey: true, shiftKey: true }, this.redo.bind(this));
    if (/Win/i.test(navigator.platform)) {
      this.quill.keyboard.addBinding({ key: 'Y', shortKey: true }, this.redo.bind(this));
    }
  }

  change(source, dest) {
    if (this.stack[source].length === 0) return;
    let delta = this.stack[source].pop();
    this.lastRecorded = 0;
    this.ignoreChange = true;
    this.quill.updateContents(delta[source], Quill.sources.USER);
    this.ignoreChange = false;
    let index = getLastChangeIndex(delta[source]);
    this.quill.setSelection(index);
    this.stack[dest].push(delta);
  }

  clear() {
    this.stack = { undo: [], redo: [] };
  }

  cutoff() {
    this.lastRecorded = 0;
  }

  record(changeDelta, oldDelta) {
    if (changeDelta.ops.length === 0) return;
    // redo 栈 置空
    this.stack.redo = [];
    // 比对差异
    let undoDelta = this.quill.getContents().diff(oldDelta);
    // 获得当前时间
    let timestamp = Date.now();

    // 这里是隔 delay 会保存一次 undo 操作 到 undo 栈中
    if (this.lastRecorded + this.options.delay > timestamp && this.stack.undo.length > 0) {
      let delta = this.stack.undo.pop();
      undoDelta = undoDelta.compose(delta.undo);
      changeDelta = delta.redo.compose(changeDelta);
    } else {
      this.lastRecorded = timestamp;
    }

    this.stack.undo.push({
      redo: changeDelta,
      undo: undoDelta
    });

    // 如果维护的 undo 栈过大就从头删除
    if (this.stack.undo.length > this.options.maxStack) {
      this.stack.undo.shift();
    }
  }

  redo() {
    this.change('redo', 'undo');
  }

  transform(delta) {
    this.stack.undo.forEach(function(change) {
      change.undo = delta.transform(change.undo, true);
      change.redo = delta.transform(change.redo, true);
    });
    this.stack.redo.forEach(function(change) {
      change.undo = delta.transform(change.undo, true);
      change.redo = delta.transform(change.redo, true);
    });
  }

  undo() {
    this.change('undo', 'redo');
  }
}
History.DEFAULTS = {
  delay: 1000,
  maxStack: 100,
  userOnly: false
};

function endsWithNewlineChange(delta) {
  let lastOp = delta.ops[delta.ops.length - 1];
  if (lastOp == null) return false;
  if (lastOp.insert != null) {
    return typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n');
  }
  if (lastOp.attributes != null) {
    return Object.keys(lastOp.attributes).some(function(attr) {
      return Parchment.query(attr, Parchment.Scope.BLOCK) != null;
    });
  }
  return false;
}

function getLastChangeIndex(delta) {
  let deleteLength = delta.reduce(function(length, op) {
    length += (op.delete || 0);
    return length;
  }, 0);
  let changeIndex = delta.length() - deleteLength;
  if (endsWithNewlineChange(delta)) {
    changeIndex -= 1;
  }
  return changeIndex;
}


export { History as default, getLastChangeIndex };
