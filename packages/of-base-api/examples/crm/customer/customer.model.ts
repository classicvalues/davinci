import { generateModel } from '../../../src/mongoose/mongoose.helpers';
import Customer from './customer.schema';

const model = generateModel(Customer);

export default model;
