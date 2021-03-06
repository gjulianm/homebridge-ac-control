import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { CeresPlatformAccesory } from './platformAccessory';

import bonjour = require('bonjour-hap');
import axios from 'axios';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class CeresHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private bonjour = bonjour();
  private managedServices = {};

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // Start the mDNS browser
      this.bonjour.find({ type: 'ceres-http' }, this.mdnsServiceUp.bind(this));
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);

    // Call mdnsServiceUp in case mDNS doesn't discover the accessory right away.
    this.mdnsServiceUp(accessory.context.service);
  }

  mdnsServiceUp(service) {
    if (this.managedServices[service.name]) {
      this.log.info(`Service ${service.name} already managed, ignoring`);
      return;
    }

    this.log.info(`ceres-http service up: ${service.name}, addresses ${service.addresses}`);
    this.managedServices[service.name] = true;

    // generate a unique id for the accessory this should be generated from
    // something globally unique, but constant, for example, the device serial
    // number or MAC address
    const uuid = this.api.hap.uuid.generate(service.name);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    const ip = service.addresses[0];

    // the accessory does not yet exist, so we need to create it
    this.log.info(`Querying features of accessory ${service.host} at ${ip}`);

    axios.get(`http://${ip}/`).then(response => {
      if (existingAccessory) {
        this.log.info('Updating existing accessory from cache:', existingAccessory.displayName);

        // Update the features of the device
        existingAccessory.context.service = service;
        existingAccessory.context.status = response.data;
        existingAccessory.context.ip = ip;

        // Create the accesory and update the context
        new CeresPlatformAccesory(this, existingAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        // create a new accessory
        const accessory = new this.api.platformAccessory(service.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.service = service;
        accessory.context.status = response.data;
        accessory.context.ip = ip;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new CeresPlatformAccesory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }).catch(error => {
      this.log.error('Cannot get features of ', ip, error);
    });
  }
}
