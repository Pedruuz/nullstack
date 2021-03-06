import {isFalse, isClass, isFunction, isText, isStatic} from '../shared/nodes';
import client from './client';
import context from './context';
import params from './params';
import router from './router';
import {generateContext} from './context';
import generateKey from '../shared/generateKey';
import routableNode from './routableNode';
import bindableNode from './bindableNode';
import {anchorableNode, anchorableElement} from './anchorableNode';
import parameterizableNode from '../shared/parameterizableNode';
import datableNode from '../shared/datableNode';
import objectEvent from './objectEvent';

export default function render(node, depth) {
  routableNode(node, depth);
  datableNode(node);
  if(isFalse(node) || node.type === 'head') {
    return document.createComment("");
  }
  objectEvent(node);
  bindableNode(node);
  if(isStatic(node)) {
    const root = (node.type.render || node.type).call(node.type, {...context, ...node.attributes});
    node.children = [root];
    return render(node.children[0], [...depth, 0]);
  }
  if(isFunction(node)) {
    const root = node.type(node.attributes);
    node.children = [root];
    return render(node.children[0], [...depth, 0]);
  }
  if(isClass(node)) {
    const key = node.attributes.key || generateKey([0, ...depth]);
    const instance = client.instances[key] || new node.type();
    const memory = window.instances[key];
    if(memory) {
      for(const attribute in memory) {
        instance[attribute] = memory[attribute];
      }
      delete window.instances[key];
      instance._self.initiated = true;
      instance._self.prerendered = true;
    }
    instance._events = {};
    instance._attributes = node.attributes;
    const context = generateContext(node.attributes);
    instance._context = context;
    if(!memory && client.instances[key] == undefined) {
      client.initiationQueue.push(instance);
      instance.prepare && instance.prepare();
    }
    client.instances[key] = instance;
    const root = instance.render();
    node.children = [root];
    client.renewalQueue.push(instance);
    instance._self.element = render(node.children[0], [...depth, 0]);
    client.hydrationQueue.push(instance);
    return instance._self.element;
  }
  if(isText(node)) {
    return document.createTextNode(node);
  }
  let element;
  let next = client.nextVirtualDom;
  let isSvg = false;
  for(const level of depth) {
    if(!next.children) break;
    next = next.children[level];
    if(!next) break;
    if(next.type === 'svg') {
      isSvg = true;
      break;
    }
  }
  if(isSvg) {
    element = document.createElementNS("http://www.w3.org/2000/svg", node.type);
  } else {
    element = document.createElement(node.type);
  }
  parameterizableNode(node, router, params);
  anchorableNode(node);
  for(let name in node.attributes) {
    if(name === 'html') {
      element.innerHTML = node.attributes[name];
      anchorableElement(element);
    } else if(name.startsWith('on')) {
      const eventName = name.replace('on', '');
      const key = generateKey(depth) + '.' + eventName;
      client.events[key] = (event) => {
        if(node.attributes.default !== true) {
          event.preventDefault();
        }
        node.attributes[name]({...node.attributes, event});
      };
      element.addEventListener(eventName, client.events[key]);
    } else {
      const type = typeof(node.attributes[name]);
      if(type !== 'object' && type !== 'function') {
        if(name != 'value' && node.attributes[name] === true) {
          element.setAttribute(name, '');
        } else if(name == 'value' || (node.attributes[name] !== false && node.attributes[name] !== null && node.attributes[name] !== undefined)) {
          element.setAttribute(name, node.attributes[name]);
        }
      }
    }
  }
  if(!node.attributes.html) {
    for(let i = 0; i < node.children.length; i++) {
      const dom = render(node.children[i], [...depth, i]);
      element.appendChild(dom);
    }
    if(node.type == 'select') {
      element.value = node.attributes.value;
    }
  }
  return element;
}