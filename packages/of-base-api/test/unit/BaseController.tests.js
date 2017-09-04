const should = require('should');
const BaseController = require('../../src/BaseController');

describe('BaseController', () => {

	describe('#get', () => {

		it('should throw an error when no model was specified', done => {
			const controller = new BaseController();

			should(() => controller.getById({})).throw('No model implemented');

			done();
		});

		it('should call model.get with the id', done => {
			const controller = new BaseController();
			controller.model = { findOne: () => ({ _id: '123' }) };
			const context = { params: { id: 123 } };

			const result = controller.getById(context);
			result.should.have.property('_id').equal('123');

			done();
		});
	});
});
