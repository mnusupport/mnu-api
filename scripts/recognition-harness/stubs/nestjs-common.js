const noop = () => () => {};
const logs = [];
class Logger { constructor(c){this.c=c} error(m){logs.push(String(m))} warn(m){logs.push(String(m))} log(){} }
module.exports = { Injectable: noop, Module: noop, Controller: noop, Post: noop, Get: noop, Param: noop, Body: noop, UseGuards: noop, HttpCode: noop, SetMetadata: noop, Logger, __logs: logs };
