var hardware = require('hardware');

var events = require('events');
var util = require('util');

var 
  REG_STATUS = 0x00,
  REG_DATA = 0x01,
  REG_CONFIG = 0x03,
  REG_ID = 0x11,

/* Status Register */
  STATUS_NOT_READY = 0x01,

/* Config Register */
  CONFIG_START = 0x01,
  CONFIG_HEAT = 0x02,
  CONFIG_HUMIDITY = 0x00,
  CONFIG_TEMPERATURE = 0x10,
  CONFIG_FAST = 0x20,

/* ID Register */
  ID_SAMPLE = 0xF0,
  ID_SI7005 = 0x50,

/* Coefficients */
  TEMPERATURE_OFFSET = 50,
  TEMPERATURE_SLOPE = 32,
  HUMIDITY_OFFSET = 24,
  HUMIDITY_SLOPE = 16,
  a0  = (-4.7844),
  a1  =  0.4008,
  a2  = (-0.00393),
  q0   = 0.1973,
  q1   = 0.00237,

  WAKE_UP_TIME  = 15
  ;

// used http://www.silabs.com/Support%20Documents/TechnicalDocs/Si7005.pdf as a reference
var ADDRESS = 0x40,
  DATAh = 0x01, // Relative Humidity or Temperature, High Byte
  DATAl = 0x02, // Relative Humidity or Temperature, Low Byte
  cs = null,
  port = null,
  LOW = 0,
  HIGH = 1
  ;


function ClimateSensor (interface, csn) {
  this.csn = csn;

  this.i2c = new hardware.I2C(interface || 0, ADDRESS);
  this.i2c.initialize();
  
  hardware.pinOutput(this.csn);
  hardware.digitalWrite(this.csn, 0);

  var self = this;
  setTimeout(function () {
    self._readRegister(REG_ID, function ok (err, reg) {
      var id = reg & ID_SAMPLE;
      if (id != ID_SI7005) {
        throw "Cannot connect to S17005. Got id: " + id.toString(16);
      }

      self.emit('connected');
    });
  }, WAKE_UP_TIME);
}

util.inherits(ClimateSensor, events.EventEmitter)

ClimateSensor.prototype._readRegister = function (addressToRead, next)
{
  this.i2c.transfer([addressToRead], 1, function (err, ret) {
    next(err, ret && ret[0]);
  });
}

// Write a single byte to the register.
ClimateSensor.prototype._writeRegister = function (addressToWrite, dataToWrite, next)
{
  this.i2c.send([addressToWrite, dataToWrite], next);
}

// reads the data registers
ClimateSensor.prototype.getData = function (configValue, next)
{
  // pull the cs line low
  hardware.digitalWrite(this.csn, 0);

  // zzz until the chip wakes up
  var self = this;
  setTimeout(function () {
    self._writeRegister(REG_CONFIG, CONFIG_START | configValue | 0, function () {
      setImmediate(function untilready () {
        self._readRegister(REG_STATUS, function (err, status) {
          if (status & STATUS_NOT_READY) {
            setImmediate(untilready);
            return;
          }

          self._writeRegister(REG_DATA, 0, function () {
            self._readRegister(DATAh, function (err, datah) {
              self._readRegister(DATAl, function (err, datal) {

                hardware.digitalWrite(self.csn, 1);
                next(null, datal | datah << 8)
              });
            });
          })
        })
      })
    });
  }, WAKE_UP_TIME);
  // tm.sleep_ms(); 
  // write_register(REG_CONFIG, CONFIG_START | configValue | 0);
}

//   var status = STATUS_NOT_READY;
//   while ( status & STATUS_NOT_READY )
//   {
//     // write_register( REG_STATUS, 0 );
//     status = read_register(REG_STATUS );
//   }

//   write_register(REG_DATA, 0);

//   var datah = read_register(DATAh);
//   var datal = read_register(DATAl);

//   csn(HIGH);

//   return datal | datah << 8;
// }

// returns % humidity
ClimateSensor.prototype.readHumidity = function (next)
{
  var self = this;
  this.getData(CONFIG_HUMIDITY, function (err, reg) {
    var rawHumidity = reg >> 4;
    var curve = ( rawHumidity / HUMIDITY_SLOPE ) - HUMIDITY_OFFSET;
    var linearHumidity = curve - ( (curve * curve) * a2 + curve * a1 + a0);
    var linearHumidity = linearHumidity + ( self._last_temperature - 30 ) * ( linearHumidity * q1 + q0 );

    next(null, linearHumidity);
  })
}

// returns temp in degrees celcius
ClimateSensor.prototype.readTemperature = function (type, next)
{
  next = next || type;

  var self = this;
  this.getData(CONFIG_TEMPERATURE, function (err, reg) {
    // console.log('Temp regs:', reg);
    var rawTemperature = reg >> 2;
    var temp = ( rawTemperature / TEMPERATURE_SLOPE ) - TEMPERATURE_OFFSET;
    self._last_temperature = temp;

    if (type == 'f') {
      temp = temp * (9/5) + 32;
    }

    next(null, temp);
  });
}

ClimateSensor.prototype.setHeader = function (status)
{
  if (status) {
    _config_reg |= CONFIG_HEAT;
  } else {
    _config_reg ^= CONFIG_HEAT;
  }
}

ClimateSensor.prototype.setFastMeasure = function  (status)
{
  if (status) {
    _config_reg |= CONFIG_FAST;
  } else {
    _config_reg ^= CONFIG_FAST;
  }
}


/**
 * Module API
 */

exports.ClimateSensor = ClimateSensor;
exports.connect = function (interface, csn) {
  return new ClimateSensor(interface, csn);
}