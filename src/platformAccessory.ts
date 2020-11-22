import { Service, PlatformAccessory, CharacteristicGetCallback, CharacteristicSetCallback } from 'homebridge';

import { CeresHomebridgePlatform } from './platform';

import axios from 'axios';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class CeresPlatformAccesory {
  private acService: Service | null;
  private humService: Service | null;
  private tempService: Service | null;

  constructor(
    private readonly platform: CeresHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.tempService = null;
    this.acService = null;
    this.humService = null;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Custom-Made')
      .setCharacteristic(this.platform.Characteristic.Model, 'ESP8266-Arduino')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'esp8266');

    if (this.accessory.context.status.features.temperature) {
      this.configureTemperatureService();
    }

    if (this.accessory.context.status.features.humidity) {
      this.configureHumidityService();
    }

    if (this.accessory.context.status.features.ac && this.accessory.context.status.features.temperature) {
      this.configureAcService();
    }
  }

  configureTemperatureService() {
    this.platform.log.info(`Configuring temperature service for ${this.accessory.displayName}`);
    this.tempService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    this.tempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));
  }

  configureHumidityService() {
    this.platform.log.info(`Configuring humidity service for ${this.accessory.displayName}`);
    this.humService = this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor);

    this.humService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .on('get', this.getHumidity.bind(this));
  }

  configureAcService() {
    this.platform.log.info(`Configuring AC service for ${this.accessory.displayName}`);

    this.acService = this.accessory.getService(this.platform.Service.HeaterCooler) ||
      this.accessory.addService(this.platform.Service.HeaterCooler);

    this.acService.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.getAcVariable.bind(this, 'on'))
      .on('set', this.setAcVariable.bind(this, 'on'));

    this.acService.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
	  .on('get', cb => this.getAcCoolingState('current', cb));

    this.acService.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .on('get', this.getAcCoolingState.bind(this, 'target'))
      .on('set', this.setAcCoolingState.bind(this));

    this.acService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));

    this.acService.getCharacteristic(this.platform.Characteristic.SwingMode)
      .on('get', this.getAcVariable.bind(this, 'swing'))
      .on('set', this.setAcVariable.bind(this, 'swing'));

    this.acService.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .on('get', this.getAcVariable.bind(this, 'temp'))
      .on('set', this.setAcVariable.bind(this, 'temp'));

    this.acService.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .on('get', this.getAcVariable.bind(this, 'temp'))
      .on('set', this.setAcVariable.bind(this, 'temp'));
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getTemperature(callback: CharacteristicGetCallback) {
    axios.get(`http://${this.accessory.context.ip}/metrics`, { responseType: 'text' }).then(response => {
      const match = response.data.match(/sensors_temperature{.*} +([0-9.]+)/m);

      if (match === null) {
        callback(new Error('Cannot parse metrics result!'), null);
      } else {
        const value = match[1];

        callback(null, parseFloat(value));
      }
    }).catch(() => {
      callback(new Error('Cannot access metrics'), null);
    });
  }

  getHumidity(callback: CharacteristicGetCallback) {
    axios.get(`http://${this.accessory.context.ip}/metrics`, { responseType: 'text' }).then(response => {
      const match = response.data.match(/sensors_humidity{.*} +([0-9.]+)/m);

      if (match === null) {
        callback(new Error('Cannot parse metrics result!'), null);
      } else {
        const value = match[1];

        callback(null, parseFloat(value));
      }
    }).catch(() => {
      callback(new Error('Cannot access metrics'), null);
    });
  }

  getAcVariable(variable: string, callback: CharacteristicGetCallback) {
    this.platform.log.debug(`Get ${variable} on ${this.accessory.context.ip}`);

    axios.get(`http://${this.accessory.context.ip}/ac/status`, { responseType: 'text' }).then(response => {
      const value = response.data[variable];

      this.platform.log.debug(`Got ${value} for ${variable} on ${this.accessory.context.ip}`);

      callback(null, response.data[variable]);
    }).catch((err) => {
      this.platform.log.error(`Cannot get variable ${variable} on ${this.accessory.context.ip}: error ${err}`);
      callback(new Error('Cannot get status'), null);
    });
  }

  setAcVariable(variable: string, value, callback: CharacteristicSetCallback) {
    const params = {};
    params[variable] = value;
    this.platform.log.debug(`Set ${variable} to ${value} on ${this.accessory.context.ip}`);

    axios.get(`http://${this.accessory.context.ip}/ac/control`, { params: params }).then(() => {
      callback(null);
    }).catch(() => {
      callback(new Error('cannot set'));
    });
  }

  // this one is a little bit different
  getAcCoolingState(mode: string, callback: CharacteristicGetCallback) {
    this.platform.log.debug(`Get coolingState on ${this.accessory.context.ip} with mode ${mode}`);

    axios.get(`http://${this.accessory.context.ip}/ac/status`, { responseType: 'text' }).then(response => {
      let value = 0;

      if (!response.data.on) {
        value = mode === 'current' ?
          this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE :
          this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      } else if (response.data.mode === 'heat') {
        value = mode === 'current' ?
          this.platform.Characteristic.CurrentHeaterCoolerState.HEATING :
          this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
      } else {
        value = mode === 'current' ?
          this.platform.Characteristic.CurrentHeaterCoolerState.COOLING :
          this.platform.Characteristic.TargetHeaterCoolerState.COOL;
      }

      callback(null, value);
    }).catch((e) => {
      this.platform.log.error(`Cannot get coolingState on ${this.accessory.context.ip} with mode ${mode}: ${e}`);
      callback(new Error(`Cannot get status: ${e}`), null);
    });
  }

  setAcCoolingState(value, callback: CharacteristicSetCallback) {
    this.platform.log.debug(`Set AC Cooling state ${value}`);

    if (value === this.platform.Characteristic.TargetHeaterCoolerState.HEAT) {
      this.setAcVariable('mode', 'heat', callback);
    } else if (value === this.platform.Characteristic.TargetHeaterCoolerState.COOL) {
      this.setAcVariable('mode', 'cool', callback);
    }
  }
}
