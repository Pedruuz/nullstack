import deserialize from './deserialize';

const metadataProxyHandler = {
  set(target, name, value) {
    if(name === 'title') {
      document.title = value;
    }
    const result = Reflect.set(...arguments);
    Nullstack.update();
    return result;
  }
}

class Router {

  set url(target) {
    history.pushState({}, document.title, target);
    Nullstack.update();
  }

  get url() {
    return window.location.pathname+window.location.search;
  }

}

const environment = {client: true, server: false, prerendered: true, production: false, development: true};
const metadata = new Proxy({...window.metadata}, metadataProxyHandler);
delete window.metadata;
const router = new Router();
const context = {environment, metadata, router};

const contextProxyHandler = {
  set(target, name, value) {
    context[name] = value;
    Nullstack.update();
    return Reflect.set(...arguments);
  }
}

const instanceProxyHandler = {
  get(target, name) {
    if(name !== 'initialize' && name !== 'initiate' && target[name] === undefined && target.constructor[name] === true) {
      const detour = async function(params = {}) {
        const url = `/${target.constructor.name}/${name}.json`;
        const response = await fetch(url, {
          method: 'POST',
          mode: 'cors',
          cache: 'no-cache',
          credentials: 'same-origin',
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify(params)
        });
        const payload = await response.text();
        return deserialize(payload).result;
      }
      target[name] = detour.bind(this);
    }
    return Reflect.get(...arguments);
  },
  set(target, name, value) {
    const result = Reflect.set(...arguments);
    Nullstack.update();
    return result;
  }
}

export default class Nullstack {

  static initialize() {
    const Starter = this;
    Nullstack.start(() => <Starter />);
  }

  static initialized = false;
  static hydrated = false;
  static initializer = null;
  
  static instances = {};
  static instancesMountedQueue = [];
  static instancesRenewedQueue = [];
  static virtualDom = {};
  static selector = null;
  static routes = {};

  static renderQueue = null;

  static start(initializer, selector='#application') {
    for(const [key, value] of Object.entries(window.context)) {
      context[key] = value;
    }
    delete window.context;
    this.routes = {};
    this.currentInstance = null;
    this.initializer = initializer;
    this.selector = document.querySelector(selector);
    this.instancesMountedQueue = [];
    this.instancesRenewedQueue = [];
    this.virtualDom = window.representation;
    this.nextVirtualDom = this.initializer();
    this.rerender(this.selector, [0], []);
    this.virtualDom = this.nextVirtualDom;
    this.nextVirtualDom = null;
    delete window.representation;
    delete window.instances;
    this.processLifecycleQueues();
  }

  static generateKey(node, depth) {
    return depth.join('.');
  }

  static generateContext(temporary) {
    return new Proxy({...context, ...temporary}, contextProxyHandler);
  }

  static getQueryStringParams(query) {
    if(query) {
      query = (/^[?#]/.test(query) ? query.slice(1) : query);
      return query.split('&').reduce((params, param) => {
        let [key, value] = param.split('=');
        params[key] = this.extractParamValue(value);
        return params;
      }, {});
    } else {
      return {};
    }
  };

  static extractParamValue(value) {
    if(value === 'true') return true;
    if (value === 'false') return false;
    if(/^\d+$/.test(value)) return parseInt(value);
    return value ? decodeURIComponent(value.replace(/\+/g, ' ')) : '';
  }

  static routeMatches(url, route) {
    let [path, query] = url.split('?');
    if(route === '*') return this.getQueryStringParams(query);
    const urlPaths = path.split('/');
    const routePaths = route.split('/');
    if(routePaths.length != urlPaths.length) return false;
    const params = {};
    for(let i = 0; i < routePaths.length; i++) {
      if(routePaths[i].startsWith(':')) {
        const key = routePaths[i].replace(':', '')
        params[key] = this.extractParamValue(urlPaths[i]);
      } else if(routePaths[i] !== urlPaths[i]) {
        return false;
      }
    }
    return {...params, ...this.getQueryStringParams(query)};
  }

  static findParentInstance(depth) {
    for(let i = 0; i < depth.length; i++) {
      const key = depth.slice(0, i * -1).join('.');
      if(this.instances[key]) {
        return this.instances[key];
      }
    }
  }

  static rerender(parent, depth, vdepth) {
    if(!this.hydrated) {
      for(const element of parent.childNodes) {
        if(element.COMMENT_NODE === 8 && element.textContent === '#') {
          parent.removeChild(element);
        }
      }
    }
    const index = depth[depth.length - 1];
    const selector = parent.childNodes[index];
    let current = this.virtualDom;
    let next = this.nextVirtualDom;
    for(const level of vdepth) {
      current = current.children[level];
      next = next.children[level];
    }
    if(this.isRoutable(next)) {
      const routeDepth = depth.slice(0,-1).join('.');
      if(this.routes[routeDepth] !== undefined) {
        next.type = false;
        next.children = [];
      } else {
        const params = this.routeMatches(router.url, next.attributes.route);
        if(params) {
          this.routes[routeDepth] = true;
          next.attributes.params = params;
        } else {
          next.type = false;
          next.children = [];
        }
      }
      delete next.attributes.route;
    }
    if(current === undefined && next !== undefined) {
      const nextSelector = this.render(next, vdepth);
      return parent.appendChild(nextSelector);
    } 
    if(current !== undefined && next === undefined) {
      return parent.removeChild(selector);
    }
    if(!this.isFalse(next) && this.isFalse(current)) {
      const nextSelector = this.render(next, vdepth);
      return parent.replaceChild(nextSelector, selector);
    }
    if(this.isFalse(next) && !this.isFalse(current)) {
      const nextSelector = this.render(next, vdepth);
      return parent.replaceChild(nextSelector, selector);
    }
    if(this.isFalse(current) && this.isFalse(next)) {
      return;
    }
    if(this.isFunction(next)) {
      const instance = this.findParentInstance([0, ...vdepth]);
      const context = this.generateContext({...instance.attributes, ...next.attributes});
      next.children = [next.type(context)];
      return this.rerender(parent, depth, [...vdepth, 0]);
    }
    if(current !== undefined && /^[A-Z]/.test(current.type) && typeof(next.type) === 'function' && current.type === next.type.name) {
      const key = this.generateKey(next, [0, ...vdepth]);
      const instance = new next.type();
      instance.events = {};
      this.instances[key] = instance;
      const state = window.instances[key];
      for(const attribute in state) {
        instance[attribute] = state[attribute];
      }
      this.instancesMountedQueue.push(instance);
      const context = this.generateContext(next.attributes);
      instance.initialize && instance.initialize(context);
      instance.attributes = next.attributes;
      this.instancesRenewedQueue.push(instance);
      next.children = [instance.render(context)];
      const limit = Math.max(current.children.length, next.children.length);
      for(let i = 0; i < limit; i++) {
        this.rerender(parent, depth, [...vdepth, i]);
      }
    } else if(this.isClass(current) && current.type === next.type) {
      const key = this.generateKey(next, [0, ...vdepth]);
      let instance = this.instances[key];
      const context = this.generateContext(next.attributes);
      if(!instance) {
        instance = new next.type();
        instance.events = {};
        this.instances[key] = instance;
        this.instancesMountedQueue.push(instance);
        instance.initialize && instance.initialize(context);
      }
      instance.attributes = next.attributes;
      this.instancesRenewedQueue.push(instance);
      next.children = [instance.render.call(instance, context)];
      const limit = Math.max(current.children.length, next.children.length);
      for(let i = 0; i < limit; i++) {
        this.rerender(parent, depth, [...vdepth, i]);
      }
    } else if (current.type !== next.type) {
      const nextSelector = this.render(next, vdepth);
      parent.replaceChild(nextSelector, selector);
    } else if (this.isText(current) && this.isText(next)) {
      if(current != next) {
        return selector.nodeValue = next;
      }
    } else if (current.type === next.type) {
      const attributeNames = Object.keys({...current.attributes, ...next.attributes});
      if(next.type === 'a' && next.attributes.href && next.attributes.href.startsWith('/')) {
        next.attributes.onclick = ({event}) => {
          event.preventDefault();
          router.url = next.attributes.href;
        };
      }
      if(next.attributes.bind) {
        const instance = this.findParentInstance([0, ...vdepth]);
        next.attributes.value = instance[next.attributes.bind];
        next.attributes.name = next.attributes.bind;
        let eventName = 'oninput';
        let valueName = 'value';
        if(next.attributes.type === 'checkbox' || next.attributes.type === 'radio') {
          eventName = 'onclick';
          valueName = 'checked';
        } else if(next.type !== 'input') {
          eventName = 'onchange';
        }
        next.attributes[eventName] = ({event}) => {
          instance[next.attributes.bind] = event.target[valueName];
        }
      }
      for(const name of attributeNames) {
        if(name === 'value') {
          if(next.attributes[name] !== selector.value) {
            selector.value = next.attributes[name];
          }
        } if(name.startsWith('on')) {
          const key = '0.' + vdepth.join('.');
          const eventName = name.replace('on', '');
          const instance = this.findParentInstance([0, ...vdepth]);
          selector.removeEventListener(eventName, instance.events[key]);
          if(next.attributes[name]) {
            instance.events[key] = (event) => {
              if(next.attributes.default !== true) {
                event.preventDefault();
              }
              const context = this.generateContext({...instance.attributes, ...next.attributes, event});
              next.attributes[name](context);
            };
            selector.addEventListener(eventName, instance.events[key]);
          } else {
            delete instance.events[key];
          }
        } else if(typeof(next.attributes[name]) !== 'function' && typeof(next.attributes[name]) !== 'object') {
          if(current.attributes[name] === undefined && next.attributes[name] !== undefined) {
            selector.setAttribute(name, next.attributes[name]);
          } else if(current.attributes[name] !== undefined && next.attributes[name] === undefined) {
            selector.removeAttribute(name);
          } else if(current.attributes[name] !== next.attributes[name]) {
            if(next.attributes[name] === false) {
              selector.removeAttribute(name);
            } else if(next.attributes[name] === true) {
              selector.setAttribute(name, name);
            } else {
              selector.setAttribute(name, next.attributes[name]);
            }
          }
        }
      }
      const limit = Math.max(current.children.length, next.children.length);
      for(let i = limit - 1; i > -1; i--) {
        this.rerender(selector, [...depth, i], [...vdepth, i]);
      }
    }
  }

  static update() {
    if(this.initialized) {
      clearInterval(this.renderQueue);
      this.renderQueue = setTimeout(() => {
        this.initialized = false;
        this.routes = {};
        this.instancesMountedQueue = [];
        this.instancesRenewedQueue = [];
        this.nextVirtualDom = this.initializer();
        this.rerender(this.selector, [0], []);
        this.virtualDom = this.nextVirtualDom;
        this.nextVirtualDom = null;
        this.processLifecycleQueues();
      }, 16);
    }
  }

  static async processLifecycleQueues() {
    if(!this.initialized) {
      this.initialized = true;
      this.hydrated = true;
    }
    for(const instance of this.instancesMountedQueue) {
      const context = this.generateContext(instance.attributes);
      instance.initiate && await instance.initiate(context);
    }
    context.environment.prerendered = false;
    for(const [id, instance] of Object.entries(this.instances)) {
      if(!this.instancesRenewedQueue.includes(instance)) {
        const context = this.generateContext(instance.attributes);
        instance.terminate && await instance.terminate(context);
        delete this.instances[id];
      }
    }
  }

  constructor() {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(this));
    const proxy = new Proxy(this, instanceProxyHandler);
    for(const method of methods) {
      if(method !== 'constructor' && typeof(this[method]) === 'function') {
        this[method] = this[method].bind(proxy);
      }
    }
    return proxy;
  }

  static flattenChildren(children) {
    children = [].concat.apply([], children).map((child) => {
      if(child === null || child === undefined) return false;
      if(child.type === 'Fragment') return this.flattenChildren(child.children);
      return child;
    });
    return [].concat.apply([], children);
  }

  static element(type, attributes = {}, ...children) {
    if(attributes === null) {
      attributes = {};
    }
    children = this.flattenChildren(children);
    if(typeof(type) === 'function' && type.render !== undefined) {
      return {type, attributes, children: []}
    }
    return {type, attributes, children};
  }

  static isFalse(node) {
    return (node === false || node.type === false);
  }

  static isBlank(node) {
    return (node === null || node === undefined);
  }

  static isRoutable(node) {
    return (node && node.attributes !== undefined && node.attributes.route !== undefined);
  }

  static isClass(node) {
    return typeof(node.type) === 'function' && typeof(node.type.prototype.render === 'function');
  }

  static isFunction(node) {
    return typeof(node.type) === 'function' && node.type.prototype === undefined;
  }

  static isText(node) {
    return node !== 'Fragment' && typeof(node.children) === 'undefined';
  }

  static render(node, depth) {
    if(this.isFalse(node)) {
      return document.createComment("");
    }
    if(this.isRoutable(node)) {
      const routeDepth = depth.slice(0,-1).join('.');
      if(this.routes[routeDepth] !== undefined) {
        node.type = false;
        node.children = [];
        return this.render(node, depth);
      }
      const params = this.routeMatches(router.url, node.attributes.route);
      if(params) {
        this.routes[routeDepth] = true;
        node.attributes.params = params;
      } else {
        node.type = false;
        node.children = [];
        return this.render(node, depth);
      }
      delete node.attributes.route;
    } 
    if(this.isFunction(node)) {
      const instance = this.findParentInstance([0, ...depth]);
      const context = this.generateContext({...instance.attributes, ...node.attributes});
      node.children = [node.type(context)];
      return this.render(node.children[0], [...depth, 0]);
    }
    if(this.isClass(node)) {
      const key = this.generateKey(node, [0, ...depth]);
      const instance = new node.type();
      instance.events = {};
      instance.attributes = node.attributes;
      this.instances[key] = instance;
      const context = this.generateContext(node.attributes);
      instance.initialize && instance.initialize(context);
      node.children = [instance.render(context)];
      this.instancesMountedQueue.push(instance);
      this.instancesRenewedQueue.push(instance);
      return this.render(node.children[0], [...depth, 0]);
    }
    if(this.isText(node)) {
      return document.createTextNode(node);
    }
    let element;
    let next = this.nextVirtualDom;
    let isSvg = false;
    for(const level of depth) {
      next = next.children[level];
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
    if(node.type === 'a' && node.attributes.href && node.attributes.href.startsWith('/')) {
      node.attributes.onclick = ({event}) => {
        event.preventDefault();
        router.url = node.attributes.href;
      };
    }
    if(node.attributes.bind) {
      const instance = this.findParentInstance([0, ...depth]);
      node.attributes.value = instance[node.attributes.bind];
      node.attributes.name = node.attributes.bind;
      let eventName = 'oninput';
      let valueName = 'value';
      if(node.attributes.type === 'checkbox' || node.attributes.type === 'radio') {
        eventName = 'onclick';
        valueName = 'checked';
      } else if(node.type !== 'input') {
        eventName = 'onchange';
      }
      node.attributes[eventName] = ({event}) => {
        instance[node.attributes.bind] = event.target[valueName];
      }
    }
    for(let name in node.attributes) {
      if(name.startsWith('on')) {
        const key = '0.' + depth.join('.');
        const eventName = name.replace('on', '');
        const instance = this.findParentInstance([0, ...depth]);
        instance.events[key] = (event) => {
          if(node.attributes.default !== true) {
            event.preventDefault();
          }
          const context = this.generateContext({...instance.attributes, ...node.attributes, event});
          node.attributes[name](context);
        };
        element.addEventListener(eventName, instance.events[key]);
      } else if(typeof(node.attributes[name]) !== 'function' && typeof(node.attributes[name]) !== 'object') {
        if(node.attributes[name] === true) {
          element.setAttribute(name, name);
        } else if(node.attributes[name] !== false) {
          element.setAttribute(name, node.attributes[name]);
        }
      }
    }
    for(let i = 0; i < node.children.length; i++) {
      const dom = this.render(node.children[i], [...depth, i]);
      element.appendChild(dom);
    }
    return element;
  }

}