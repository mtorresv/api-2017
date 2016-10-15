var registration = require('../utils/registration');

var Model = require('./Model');
var Mentor = Model.extend({
	tableName: 'mentors',
	idAttribute: 'id',
	validations: {
		first_name: ['required', 'string', 'maxLength:255'],
		last_name:  ['required', 'string', 'maxLength:255'],
		shirt_size: ['required', 'string', registration.verifyTshirtSize],
		github:     ['string', 'maxLength:50'],
		location:    ['required', 'string', 'maxLength:255'],
		summary:    ['required', 'string', 'maxLength:255'],
		occupation: ['required', 'string', 'maxLength:255'],
		user_id:    ['required', 'integer']
	},
	ideas: function () {
		return this.hasMany(MentorProjectIdea);
	}
});


/**
* Finds a mentor by its relational user's id, joining in its related project ideas
* @param  {Number|String} id	the ID of the user with the appropriate type
* @return {Promise<Model>}	a Promise resolving to the resulting mentor or null
*/
Mentor.findByUserId = function (userId) {
	return Mentor.where({ user_id: userId }).fetch({ withRelated: ['ideas'] });
};

/**
* Finds a mentor by its ID, joining in its related project ideas
* @param  {Number|String} id	the ID of the model with the appropriate type
* @return {Promise<Model>}		a Promise resolving to the resulting model or null
*/
Mentor.findById = function (id) {
	return Mentor.where({ id: id }).fetch({ withRelated: ['ideas'] });
};

module.exports = Mentor;
