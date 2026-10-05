const noop = () => () => {};
const SchemaFactory = { createForClass: () => ({ index(){ } }) };
module.exports = { InjectModel: noop, Prop: noop, Schema: noop, SchemaFactory, MongooseModule: { forFeature: () => ({}) } };
