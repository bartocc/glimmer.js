import { metaFor, trackedGet } from '@glimmer/tracking';
import { CURRENT_TAG } from '@glimmer/reference';

import GlimmerComponent from '../addon/-private/component';
import { assert } from '@glimmer/util';

export interface Bounds {
  firstNode: Node;
  lastNode: Node;
}

export default class Component<T extends object = object> extends GlimmerComponent<T> {
  get args() {
    trackedGet(this, 'args');
    return this.__args__;
  }

  set args(args) {
    this.__args__ = args;
    metaFor(this)
      .updatableTagFor('args')
      .inner.update(CURRENT_TAG);
  }

  /** @private
   * Slot on the component to save Arguments object passed to the `args` setter.
   */
  private __args__: T;

  /**
   * Development-mode only name of the component, useful for debugging.
   */
  debugName: string | null = null;

  toString() {
    return `${this.debugName} component`;
  }

  /*
   * Legacy DOM access and lifecycle hooks. These will be deprecated in favor
   * of render modifiers once Glimmer.js supports an element modifier manager
   * API.
   */

  /**
   * Called when the component has been inserted into the DOM.
   * Override this function to do any set up that requires an element in the document body.
   */
  didInsertElement() {}

  /**
   * Called when the component has updated and rerendered itself.
   * Called only during a rerender, not during an initial render.
   */
  didUpdate() {}

  /**
   * Contains the first and last DOM nodes of a component's rendered template.
   * These nodes can be used to traverse all of the DOM nodes that belong to a
   * particular component.
   *
   * Note that a component's first and last nodes *can* change over time, if the
   * beginning or ending of the template is dynamic. You should always access
   * `bounds` directly at the time a node is needed to ensure you are acting on
   * up-to-date nodes.
   *
   * ### Examples
   *
   * For components with a single root element, `this.bounds.firstNode` and
   * `this.bounds.lastNode` are the same.
   *
   * ```hbs
   * <div class="user-profile">
   *   <Avatar @user={{user}} />
   * </div>
   * ```
   *
   * ```ts
   * export default class extends Component {
   *   didInsertElement() {
   *     let { firstNode, lastNode } = this.bounds;
   *     console.log(firstNode === lastNode); // true
   *     console.log(firstNode.className); // "user-profile"
   *   }
   * }
   * ```
   *
   * For components with multiple root nodes, `this.bounds.firstNode` refers to
   * the first node in the template and `this.bounds.lastNode` refers to the
   * last:
   *
   * ```hbs
   * Welcome to Glimmer.js!
   * <span>Let's build some components!</span>
   * <img src="logo.png">
   * ```
   *
   * ```ts
   * export default class extends Component {
   *   didInsertElement() {
   *     let { firstNode, lastNode } = this.bounds;
   *
   *     // Walk all of the DOM siblings from the
   *     // firstNode to the lastNode and push their
   *     // nodeName into an array.
   *     let node = firstNode;
   *     let names = [firstNode.nodeName];
   *     do {
   *       node = node.nextSibling;
   *       names.push(node.nodeName);
   *     } while (node !== lastNode);
   *
   *     console.log(names);
   *     // ["#text", "SPAN", "IMG"]
   *   }
   * }
   * ```
   *
   * The bounds can change if the template has dynamic content at the beginning
   * or the end:
   *
   * ```hbs
   * {{#if user.isAdmin}}
   *   <span class="warning">Admin</span>
   * {{else}}
   *   Normal User
   * {{/if}}
   * ```
   *
   * In this example, the `firstNode` will change between a `span` element and a
   * `TextNode` as the `user.isAdmin` property changes.
   */
  bounds: Bounds;

  /**
   * The element corresponding to the main element of the component's template.
   * The main element is the element in the template that has `...attributes` set on it:
   *
   * ```hbs
   * <h1>Modal</h1>
   * <div class="contents" ...attributes>
   *   {{yield}}
   * </div>
   * ```
   *
   * In this example, `this.element` would be the `div` with the class `contents`.
   *
   * You should not try to access this property until after the component's `didInsertElement()`
   * lifecycle hook is called.
   */
  get element(): HTMLElement {
    let { bounds } = this;
    assert(
      bounds && bounds.firstNode === bounds.lastNode,
      `The 'element' property can only be accessed on components that contain a single root element in their template. Try using 'bounds' instead to access the first and last nodes.`
    );
    return bounds.firstNode as HTMLElement;
  }
}

export interface ComponentFactory {
  create(injections: object): Component;
}
