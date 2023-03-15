import extend from 'extend';
import Delta from 'quill-delta';
import Parchment from 'parchment';
import Quill from '../core/quill';
import logger from '../core/logger';
import Module from '../core/module';

import { AlignAttribute, AlignStyle } from '../formats/align';
import { BackgroundStyle } from '../formats/background';
import CodeBlock from '../formats/code';
import { ColorStyle } from '../formats/color';
import { DirectionAttribute, DirectionStyle } from '../formats/direction';
import { FontStyle } from '../formats/font';
import { SizeStyle } from '../formats/size';

let debug = logger('quill:clipboard');


const DOM_KEY = '__ql-matcher';

// 剪切板
const CLIPBOARD_CONFIG = [
  [Node.TEXT_NODE, matchText],
  [Node.TEXT_NODE, matchNewline],
  ['br', matchBreak],
  [Node.ELEMENT_NODE, matchNewline],
  [Node.ELEMENT_NODE, matchBlot],
  [Node.ELEMENT_NODE, matchSpacing],
  [Node.ELEMENT_NODE, matchAttributor],
  [Node.ELEMENT_NODE, matchStyles],
  ['li', matchIndent],
  ['b', matchAlias.bind(matchAlias, 'bold')],
  ['i', matchAlias.bind(matchAlias, 'italic')],
  ['style', matchIgnore]
];

const ATTRIBUTE_ATTRIBUTORS = [
  AlignAttribute,
  DirectionAttribute
].reduce(function(memo, attr) {
  memo[attr.keyName] = attr;
  return memo;
}, {});

const STYLE_ATTRIBUTORS = [
  AlignStyle,
  BackgroundStyle,
  ColorStyle,
  DirectionStyle,
  FontStyle,
  SizeStyle
].reduce(function(memo, attr) {
  memo[attr.keyName] = attr;
  return memo;
}, {});


class Clipboard extends Module {
  constructor(quill, options) {
    super(quill, options);
    this.quill.root.addEventListener('paste', this.onPaste.bind(this));
    this.container = this.quill.addContainer('ql-clipboard');
    this.container.setAttribute('contenteditable', true);
    this.container.setAttribute('tabindex', -1);
    this.matchers = [];
    CLIPBOARD_CONFIG.concat(this.options.matchers).forEach(([selector, matcher]) => {
      if (!options.matchVisual && matcher === matchSpacing) return;
      this.addMatcher(selector, matcher);
    });
  }

  addMatcher(selector, matcher) {
    this.matchers.push([selector, matcher]);
  }

  convert(html) {
    if (typeof html === 'string') {
      this.container.innerHTML = html.replace(/\>\r?\n +\</g, '><'); // Remove spaces between tags
      return this.convert();
    }
    const formats = this.quill.getFormat(this.quill.selection.savedRange.index);
    if (formats[CodeBlock.blotName]) {
      const text = this.container.innerText;
      this.container.innerHTML = '';
      return new Delta().insert(text, { [CodeBlock.blotName]: formats[CodeBlock.blotName] });
    }
    let [elementMatchers, textMatchers] = this.prepareMatching();
    let delta = traverse(this.container, elementMatchers, textMatchers);
    // Remove trailing newline
    if (deltaEndsWith(delta, '\n') && delta.ops[delta.ops.length - 1].attributes == null) {
      delta = delta.compose(new Delta().retain(delta.length() - 1).delete(1));
    }
    debug.log('convert', this.container.innerHTML, delta);
    this.container.innerHTML = '';
    return delta;
  }

  dangerouslyPasteHTML(index, html, source = Quill.sources.API) {
    if (typeof index === 'string') {
      return this.quill.setContents(this.convert(index), html);
    } else {
      let paste = this.convert(html);
      return this.quill.updateContents(new Delta().retain(index).concat(paste), source);
    }
  }

  onPaste(e) {
    if (e.defaultPrevented || !this.quill.isEnabled()) return;
    let range = this.quill.getSelection();
    let delta = new Delta().retain(range.index);
    let scrollTop = this.quill.scrollingContainer.scrollTop;
    this.container.focus();
    this.quill.selection.update(Quill.sources.SILENT);
    setTimeout(() => {
      delta = delta.concat(this.convert()).delete(range.length);
      this.quill.updateContents(delta, Quill.sources.USER);
      // range.length contributes to delta.length()
      this.quill.setSelection(delta.length() - range.length, Quill.sources.SILENT);
      this.quill.scrollingContainer.scrollTop = scrollTop;
      this.quill.focus();
    }, 1);
  }

  // 选择匹配的 match
  prepareMatching() {
    let elementMatchers = [], textMatchers = [];
    this.matchers.forEach((pair) => {
      let [selector, matcher] = pair;
      switch (selector) {
        // 文本
        case Node.TEXT_NODE:
          textMatchers.push(matcher);
          break;
       // 元素 
        case Node.ELEMENT_NODE:
          elementMatchers.push(matcher);
          break;
        default:
      // 其他 比如 li b i br style 这些
          [].forEach.call(this.container.querySelectorAll(selector), (node) => {
            // TODO use weakmap
            node[DOM_KEY] = node[DOM_KEY] || [];
            // 保存在 node['ql-matcher] 中
            node[DOM_KEY].push(matcher);
          });
          break;
      }
    });
    // 将找到的 matcher 返回
    return [elementMatchers, textMatchers];
  }
}
Clipboard.DEFAULTS = {
  matchers: [],
  matchVisual: true
};

// 处理样式问题
function applyFormat(delta, format, value) {
  if (typeof format === 'object') {
    return Object.keys(format).reduce(function(delta, key) {
      return applyFormat(delta, key, format[key]);
    }, delta);
  } else {
    return delta.reduce(function(delta, op) {
      if (op.attributes && op.attributes[format]) {
        return delta.push(op);
      } else {
        return delta.insert(op.insert, extend({}, {[format]: value}, op.attributes));
      }
    }, new Delta());
  }
}

function computeStyle(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return {};
  const DOM_KEY = '__ql-computed-style';
  return node[DOM_KEY] || (node[DOM_KEY] = window.getComputedStyle(node));
}

// 判断 delta 中最后一个 是不是等于 text 
function deltaEndsWith(delta, text) {
  let endText = "";
  for (let i = delta.ops.length - 1; i >= 0 && endText.length < text.length; --i) {
    let op  = delta.ops[i];
    if (typeof op.insert !== 'string') break;
    endText = op.insert + endText;
  }
  return endText.slice(-1*text.length) === text;
}

function isLine(node) {
  // 排除嵌入元素
  if (node.childNodes.length === 0) return false;   // Exclude embed blocks
  let style = computeStyle(node);
  // 当元素的 style == 'block' | 'list-item' 时候就返回 true 
  return ['block', 'list-item'].indexOf(style.display) > -1;
}

// 转换 【后序遍历】
function traverse(node, elementMatchers, textMatchers) {  // Post-order
  // 文本节点
  if (node.nodeType === node.TEXT_NODE) {
    return textMatchers.reduce(function(delta, matcher) {
      return matcher(node, delta);
    }, new Delta());
  // 元素节点
  } else if (node.nodeType === node.ELEMENT_NODE) {
    return [].reduce.call(node.childNodes || [], (delta, childNode) => {
      let childrenDelta = traverse(childNode, elementMatchers, textMatchers);
      if (childNode.nodeType === node.ELEMENT_NODE) {
        childrenDelta = elementMatchers.reduce(function(childrenDelta, matcher) {
          return matcher(childNode, childrenDelta);
        }, childrenDelta);
        childrenDelta = (childNode[DOM_KEY] || []).reduce(function(childrenDelta, matcher) {
          return matcher(childNode, childrenDelta);
        }, childrenDelta);
      }
      return delta.concat(childrenDelta);
    }, new Delta());
  } else {
    // 返回 {ops: []}
    return new Delta();
  }
}


function matchAlias(format, node, delta) {
  return applyFormat(delta, format, true);
}

// 处理属性
function matchAttributor(node, delta) {
  let attributes = Parchment.Attributor.Attribute.keys(node);
  let classes = Parchment.Attributor.Class.keys(node);
  let styles = Parchment.Attributor.Style.keys(node);
  let formats = {};
  // 将 class style arributes 都组合在 formats 上 
  attributes.concat(classes).concat(styles).forEach((name) => {
    let attr = Parchment.query(name, Parchment.Scope.ATTRIBUTE);
    if (attr != null) {
      formats[attr.attrName] = attr.value(node);
      if (formats[attr.attrName]) return;
    }
    attr = ATTRIBUTE_ATTRIBUTORS[name];
    if (attr != null && attr.attrName === name) {
      formats[attr.attrName] = attr.value(node) || undefined;
    }
    attr = STYLE_ATTRIBUTORS[name]
    if (attr != null && attr.attrName === name) {
      attr = STYLE_ATTRIBUTORS[name];
      formats[attr.attrName] = attr.value(node) || undefined;
    }
  });
  // 处理将 formats 添加到 delta 上
  if (Object.keys(formats).length > 0) {
    delta = applyFormat(delta, formats);
  }
  return delta;
}

function matchBlot(node, delta) {
  // 找到对应的 blot 
  let match = Parchment.query(node);
  if (match == null) return delta;
  // 如果是嵌入结构
  if (match.prototype instanceof Parchment.Embed) {
    let embed = {};
    let value = match.value(node);
    if (value != null) {
      embed[match.blotName] = value;
      delta = new Delta().insert(embed, match.formats(node));
    }
  } else if (typeof match.formats === 'function') {
    delta = applyFormat(delta, match.blotName, match.formats(node));
  }
  return delta;
}

function matchBreak(node, delta) {
  if (!deltaEndsWith(delta, '\n')) {
    delta.insert('\n');
  }
  return delta;
}

// 空的数据
function matchIgnore() {
  return new Delta();
}

// 缩进
function matchIndent(node, delta) {
  let match = Parchment.query(node);
  if (match == null || match.blotName !== 'list-item' || !deltaEndsWith(delta, '\n')) {
    return delta;
  }
  let indent = -1, parent = node.parentNode;
  while (!parent.classList.contains('ql-clipboard')) {
    if ((Parchment.query(parent) || {}).blotName === 'list') {
      indent += 1;
    }
    parent = parent.parentNode;
  }
  if (indent <= 0) return delta;
  return delta.compose(new Delta().retain(delta.length() - 1).retain(1, { indent: indent}));
}

// 匹配新的一行
function matchNewline(node, delta) {
  if (!deltaEndsWith(delta, '\n')) {
    // 如果节点是行元素或者下一个节点也是行元素那么就插入 '\n'
    if (isLine(node) || (delta.length() > 0 && node.nextSibling && isLine(node.nextSibling))) {
      delta.insert('\n');
    }
  }
  return delta;
}

// 这里是做了一个匹配 如果下一个元素的空间 offsetTop 大于 元素 offsetTop + 自身高度的1.5倍就会在加上 \n
function matchSpacing(node, delta) {
  if (isLine(node) && node.nextElementSibling != null && !deltaEndsWith(delta, '\n\n')) {
    let nodeHeight = node.offsetHeight + parseFloat(computeStyle(node).marginTop) + parseFloat(computeStyle(node).marginBottom);
    if (node.nextElementSibling.offsetTop > node.offsetTop + nodeHeight*1.5) {
      delta.insert('\n');
    }
  }
  return delta;
}


// 处理样式问题
function matchStyles(node, delta) {
  let formats = {};
  let style = node.style || {};
  if (style.fontStyle && computeStyle(node).fontStyle === 'italic') {
    // 添加属性 是否倾斜
    formats.italic = true;
  }
  if (style.fontWeight && (computeStyle(node).fontWeight.startsWith('bold') ||
                           parseInt(computeStyle(node).fontWeight) >= 700)) {
    // 是否加粗
    formats.bold = true;
  }
  // 默认的样式处理方法
  if (Object.keys(formats).length > 0) {
    delta = applyFormat(delta, formats);
  }
  // 缩进
  if (parseFloat(style.textIndent || 0) > 0) {  // Could be 0.5in
    delta = new Delta().insert('\t').concat(delta);
  }
  return delta;
}

/**
 * 匹配文本
 * @param {*} node  要匹配的元素
 * @param {*} delta {ops: []}
 * @returns 
 */
function matchText(node, delta) {
  let text = node.data;
  // Word represents empty line with <o:p>&nbsp;</o:p>
  if (node.parentNode.tagName === 'O:P') {
    // delta 添加 text 
    return delta.insert(text.trim());
  }
  if (text.trim().length === 0 && node.parentNode.classList.contains('ql-clipboard')) {
    // 如果是剪切板内容就直接返回
    return delta;
  }
  if (!computeStyle(node.parentNode).whiteSpace.startsWith('pre')) {
    // eslint-disable-next-line func-style
    // 当 collapse == true 保留 ' ' 否则 ''
    let replacer = function(collapse, match) {
      // 匹配空格 替换成 ''
      match = match.replace(/[^\u00a0]/g, '');    // \u00a0 is nbsp;
      // 确保 ' ' 不会被无故删除 
      return match.length < 1 && collapse ? ' ' : match;
    };
    // \r \n 替换成 ' '
    text = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
    // 单词边界替换成 '' 有空格的会保留 ' '
    text = text.replace(/\s\s+/g, replacer.bind(replacer, true));  // collapse whitespace
    // 前的兄弟节点 == null && 父节点是 行元素  or 有兄弟节点 && 兄弟节点为 行元素
    if ((node.previousSibling == null && isLine(node.parentNode)) ||
        (node.previousSibling != null && isLine(node.previousSibling))) {
      // 找到文本首部的空白符号 替换为 ''
      text = text.replace(/^\s+/, replacer.bind(replacer, false));
    }
    // 后的兄弟节点
    if ((node.nextSibling == null && isLine(node.parentNode)) ||
        (node.nextSibling != null && isLine(node.nextSibling))) {
      // 排除后的空白符号 替换为 ''
      text = text.replace(/\s+$/, replacer.bind(replacer, false));
    }
  }
  // 最终添加在 delta 数据中
  return delta.insert(text);
}


export { Clipboard as default, matchAttributor, matchBlot, matchNewline, matchSpacing, matchText };
