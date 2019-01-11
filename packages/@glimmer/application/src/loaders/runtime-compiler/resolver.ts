import { expect } from "@glimmer/util";
import {
  Option,
  Maybe,
  Dict,
  JitRuntimeResolver,
  Helper as GlimmerHelper,
  ModifierManager,
  Invocation,
  Helper,
  Template
} from "@glimmer/interfaces";
import { Owner } from "@glimmer/di";
import {
  ComponentDefinition,
  ComponentManager,
  ComponentFactory
} from "@glimmer/component";

import { TypedRegistry } from "./typed-registry";
import Application from "../../application";
import { HelperReference } from "../../helpers/user-helper";
import { TemplateFactory, templateFactory } from "@glimmer/opcode-compiler";
import { PrecompileOptions, precompile } from "@glimmer/compiler";

export type UserHelper = (
  args: ReadonlyArray<unknown>,
  named: Dict<unknown>
) => unknown;

export interface Lookup {
  helper: GlimmerHelper;
  modifier: ModifierManager;
  component: ComponentDefinition;
  template: SerializedTemplateWithLazyBlock<Specifier>;
  manager: ComponentManager;
  compiledTemplate: Invocation;
}

export type LookupType = keyof Lookup;

export interface Specifier {
  specifier: string;
  managerId?: string;
}

export type TemplateEntry = {
  handle: number;
  name: string;
  meta: Specifier;
};

export type SerializedTemplateBlockJSON = string;

export interface SerializedTemplateWithLazyBlock<Specifier> {
  id?: Option<string>;
  block: SerializedTemplateBlockJSON;
  meta: Specifier;
}

/** @public */
export default class ApplicationJitRuntimeResolver
  implements JitRuntimeResolver<Specifier> {
  handleLookup: TypedRegistry<unknown>[] = [];

  private cache = {
    component: new TypedRegistry<ComponentDefinition>(),
    template: new TypedRegistry<SerializedTemplateWithLazyBlock<Specifier>>(),
    compiledTemplate: new TypedRegistry<Invocation>(),
    helper: new TypedRegistry<Helper>(),
    manager: new TypedRegistry<ComponentManager>(),
    modifier: new TypedRegistry<ModifierManager<unknown, unknown>>()
  };

  constructor(private owner: Owner) {}

  lookup(type: LookupType, name: string, referrer?: Specifier): Option<number> {
    if (this.cache[type].hasName(name)) {
      return this.cache[type].getHandle(name);
    } else {
      return null;
    }
  }

  get<K extends LookupType>(
    type: K,
    name: string,
    referrer?: Specifier
  ): Option<Lookup[K]> {
    if (this.cache[type].hasName(name)) {
      let handle = this.cache[type].getHandle(name);
      return this.cache[type].getByHandle(handle);
    } else {
      return null;
    }
  }

  register<K extends LookupType>(
    type: K,
    name: string,
    value: Lookup[K]
  ): number {
    let registry = this.cache[type];
    let handle = this.handleLookup.length;
    this.handleLookup.push(registry);
    (this.cache[type] as TypedRegistry<any>).register(handle, name, value);
    return handle;
  }

  lookupModifier(name: string, meta?: Specifier): Option<number> {
    let handle = this.lookup("modifier", name);

    if (handle === null) {
      throw new Error(`Modifier for ${name} not found.`);
    }

    return handle;
  }

  compilableFrom(name: string, referrer?: Specifier): Template {
    let specifier = this.owner.identify(`template:${name}`, referrer.specifier);
    return this.compilable({ specifier });
  }

  compilable(locator: Specifier): Template {
    let serializedTemplate = this.get("template", locator.specifier);
    return templateFactory(serializedTemplate).create();
  }

  registerHelper(name: string, helper: UserHelper) {
    let glimmerHelper: GlimmerHelper = args =>
      new HelperReference(helper, args);
    return this.register("helper", name, glimmerHelper);
  }

  registerInternalHelper(name: string, helper: GlimmerHelper) {
    this.register("helper", name, helper);
  }

  registerComponent(
    name: string,
    resolvedSpecifier: string,
    Component: ComponentFactory,
    template: SerializedTemplateWithLazyBlock<Specifier>
  ): number {
    let templateEntry = this.registerTemplate(resolvedSpecifier, template);
    let manager = this.managerFor(templateEntry.meta.managerId);
    let definition = new ComponentDefinition(
      name,
      manager,
      Component,
      templateEntry.handle
    );

    return this.register("component", name, definition);
  }

  lookupComponent(name: string, referrer?: Specifier): ComponentDefinition {
    if (!this.cache.component.hasName(name)) {
      this.lookupComponentDefinition(name, referrer);
    }
    return this.get("component", name, referrer);
  }

  lookupComponentHandle(name: string, referrer?: Specifier) {
    if (!this.cache.component.hasName(name)) {
      this.lookupComponentDefinition(name, referrer);
    }
    return this.lookup("component", name, referrer);
  }

  managerFor(managerId = "main"): ComponentManager {
    let manager: ComponentManager;

    if (!this.cache.manager.hasName(managerId)) {
      let { rootName } = this.owner as Application;
      manager = this.owner.lookup(
        `component-manager:/${rootName}/component-managers/${managerId}`
      );
      if (!manager) {
        throw new Error(`No component manager found for ID ${managerId}.`);
      }
      this.register("manager", managerId, manager);
      return manager;
    } else {
      let handle = this.cache.manager.getHandle(managerId);
      return this.cache.manager.getByHandle(handle);
    }
  }

  registerTemplate(
    resolvedSpecifier: string,
    template: SerializedTemplateWithLazyBlock<Specifier>
  ): TemplateEntry {
    return {
      name: resolvedSpecifier,
      handle: this.register("template", resolvedSpecifier, template),
      meta: template.meta
    };
  }

  lookupComponentDefinition(
    name: string,
    meta: Specifier
  ): ComponentDefinition {
    let handle: number;
    if (!this.cache.component.hasName(name)) {
      let specifier = expect(
        this.identifyComponent(name, meta),
        `Could not find the component '${name}'`
      );
      let template = this.owner.lookup("template", specifier);
      let componentSpecifier = this.owner.identify("component", specifier);
      let componentFactory: ComponentFactory = null;

      if (componentSpecifier !== undefined) {
        componentFactory = this.owner.factoryFor(componentSpecifier);
      }

      handle = this.registerComponent(
        name,
        specifier,
        componentFactory,
        template
      );
    } else {
      handle = this.lookup("component", name, meta);
    }

    return this.resolve<ComponentDefinition>(handle);
  }

  lookupHelper(name: string, meta?: Specifier): Option<number> {
    if (!this.cache.helper.hasName(name)) {
      let owner: Owner = this.owner;
      let relSpecifier = `helper:${name}`;
      let referrer: string = meta.specifier;

      let specifier = owner.identify(relSpecifier, referrer);
      if (specifier === undefined) {
        return null;
      }

      let helper = this.owner.lookup(specifier, meta.specifier);
      return this.registerHelper(name, helper);
    }

    return this.lookup("helper", name, meta);
  }

  lookupPartial(name: string, referrer?: Specifier): never {
    throw new Error("Partials are not available in Glimmer applications.");
  }

  resolve<T>(handle: number): T {
    let registry = this.handleLookup[handle];
    return registry.getByHandle(handle) as T;
  }

  private identifyComponent(name: string, meta: Specifier): Maybe<string> {
    let owner: Owner = this.owner;
    let relSpecifier = `template:${name}`;
    let referrer: string = meta.specifier;

    let specifier = owner.identify(relSpecifier, referrer);

    if (
      specifier === undefined &&
      owner.identify(`component:${name}`, referrer)
    ) {
      throw new Error(
        `The component '${name}' is missing a template. All components must have a template. Make sure there is a template.hbs in the component directory.`
      );
    }

    return specifier;
  }
}

export function createTemplate<Locator>(
  templateSource: string,
  options?: PrecompileOptions
): TemplateFactory<Locator> {
  let wrapper: SerializedTemplateWithLazyBlock<Locator> = JSON.parse(
    precompile(templateSource, options)
  );
  return templateFactory<Locator>(wrapper);
}
