import { ValidationError } from 'auth0-extension-tools';

import constants from '../../constants';
import DefaultHandler from './default';
import { calcChanges } from '../../utils';

export const excludeSchema = {
  type: 'array',
  items: { type: 'string' }
};

export const schema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      identifier: { type: 'string' },
      scopes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' }
          }
        }
      }
    },
    require: [ 'name', 'identifier' ]
  }
};


export default class ResourceServersHandler extends DefaultHandler {
  constructor(options) {
    super({
      ...options,
      type: 'resourceServers',
      stripUpdateFields: [ 'identifier' ] // Fields not allowed in updates
    });
  }

  didDelete(resourceServer) {
    return super.didDelete({ name: resourceServer.name, identifier: resourceServer.identifier });
  }

  didCreate(resourceServer) {
    return super.didCreate({ name: resourceServer.name, identifier: resourceServer.identifier });
  }

  didUpdate(resourceServer) {
    return super.didUpdate({ name: resourceServer.name, identifier: resourceServer.identifier });
  }

  async getType() {
    if (this.existing) return this.existing;
    const resourceServers = await this.client.resourceServers.getAll({ paginate: true });
    return resourceServers.filter(rs => rs.name !== constants.RESOURCE_SERVERS_MANAGEMENT_API_NAME);
  }

  async calcChanges(assets) {
    let { resourceServers } = assets;

    // Do nothing if not set
    if (!resourceServers || !resourceServers.length) return {};

    const excluded = assets.exclude.resourceServers || [];

    let existing = await this.getType();

    // Filter excluded
    resourceServers = resourceServers.filter(r => !excluded.includes(r.name));
    existing = existing.filter(r => !excluded.includes(r.name));

    return calcChanges(resourceServers, existing, [ 'id', 'name' ]);
  }

  async validate(assets) {
    const { resourceServers } = assets;

    // Do nothing if not set
    if (!resourceServers || !resourceServers.length) return;

    const mgmtAPIResource = resourceServers.filter(r => r.name === constants.RESOURCE_SERVERS_MANAGEMENT_API_NAME)[0];
    if (mgmtAPIResource) {
      throw new ValidationError(`You can not configure the '${constants.RESOURCE_SERVERS_MANAGEMENT_API_NAME}.`);
    }

    await super.validate(assets);
  }
}
