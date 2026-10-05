const crypto = require('crypto');
let counter = Math.floor(Math.random()*0xffffff);
class ObjectId {
  constructor(v){ this.hex = v ? String(v) : (Date.now().toString(16).padStart(8,'0').slice(-8) + crypto.randomBytes(5).toString('hex') + (counter = (counter+1)&0xffffff).toString(16).padStart(6,'0')); }
  toString(){ return this.hex }
  equals(o){ return String(o) === this.hex }
  static isValid(v){ return typeof v === 'string' ? /^[0-9a-f]{24}$/i.test(v) : v instanceof ObjectId }
}
module.exports = { Types: { ObjectId } };
