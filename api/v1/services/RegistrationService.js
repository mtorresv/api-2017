/* jshint esversion: 6 */

var CheckitError = require('checkit').Error;
var _Promise = require('bluebird');
var _ = require('lodash');

var Mentor = require('../models/Mentor');
var MentorProjectIdea = require('../models/MentorProjectIdea');
var UserRole = require('../models/UserRole');
var errors = require('../errors');
var utils = require('../utils');

/**
 * Persists a mentor and its ideas
 * @param  {Mentor} mentor	a mentor object to be created/updated
 * @param  {Array} ideas 	an array of raw mentor attributes
 * @param  {Transaction} t	a pending transaction
 * @return {Promise<Mentor>} the mentor with related ideas
 */
function _saveMentorAndIdeas(mentor, ideas, t) {
	return mentor
		.save(null, { transacting: t })
		.then(function (mentor) {
			return _Promise.map(ideas, function (idea) {
				return mentor.related('ideas').create(idea, { transacting: t });
			}).return(mentor);
		});
}

/**
 * Determines which ideas are new and which are
 * existing ones that need to be updated
 * @param  {Mentor} mentor		the Mentor with whom the ideas are associated
 * @param  {Array} mentorIdeas	the list of MentorProjectIdea objects/attributes
 * @return {Array}				containing the new ideas, updated ideas, and ids of updated ideas
 */
function _extractMentorIdeas(mentor, mentorIdeas) {
	var newIdeas = [];
	var updatedIdeas = [];
	var updatedIdeaIds = [];

	_.forEach(mentorIdeas, function (idea) {
		var MESSAGE, SOURCE;
		if (!_.has(idea, 'id')) {
			newIdeas.push(idea);
		} else if (_.isUndefined(mentor.related('ideas').get(idea.id))) {
			MESSAGE = "A MentorProjectIdea with the given ID does not exist";
			SOURCE = "idea.id";
			throw new errors.NotFoundError(MESSAGE, SOURCE);
		} else if (mentor.related('ideas').get(idea.id).get('mentorId') !== mentor.get('id')){
			MESSAGE = "A MentorProjectIdea that does not belong to this mentor cannot be updated here";
			throw new errors.UnauthorizedError(MESSAGE);
		} else {
			// TODO remove this once Request validator can marshal recursively
			idea.mentorId = mentor.get('id');

			updatedIdeas.push(mentor.related('ideas').get(idea.id).set(idea));
			updatedIdeaIds.push(idea.id);
		}
	});

	return _Promise.all([newIdeas, updatedIdeas, updatedIdeaIds]);
}

/**
 * Removes unwanted ideas and updates desired ideas
 * @param  {Mentor} mentor			the Mentor with whom the ideas are associated
 * @param  {Array} updatedIdeas		a list of related MentorProjectIdeas with new attributes
 * @param  {Array} updatedIdeaIds	a list of the ids contained in the updatedIdeas
 * @param  {Transaction} t			a pending transaction
 * @return {Promise<>}				a promise indicating all changes have been added to the transaction
 */
function _adjustMentorIdeas(mentor, updatedIdeas, updatedIdeaIds, t) {
	return mentor.related('ideas')
		.query().transacting(t)
		.whereNotIn('id', updatedIdeaIds)
		.delete()
		.catch(Mentor.NoRowsDeletedError, function () { return null; })
		.then(function () {
			mentor.related('ideas').reset();

			return _Promise.map(updatedIdeas, function (idea) {
				mentor.related('ideas').add(idea);
				return idea.save(null, { transacting: t, require: false });
			});
		});
}

/**
* Registers a mentor and their project ideas for the given user
* @param  {Object} user the user for which a mentor will be registered
* @param  {Object} attributes a JSON object holding the mentor attributes
* @return {Promise<Mentor>} the mentor with related ideas
* @throws {InvalidParameterError} when a mentor exists for the specified user
*/
var createMentor = function (user, attributes) {
	var mentorAttributes = attributes.mentor;
	var mentorIdeas = attributes.ideas;

	mentorAttributes.userId = user.get('id');
	var mentor = Mentor.forge(mentorAttributes);

	return mentor
		.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (validated) {
			if (user.hasRole(utils.roles.MENTOR, false)) {
				var message = "The given user has already registered as a mentor";
				var source = "userId";
				throw new errors.InvalidParameterError(message, source);
			}

			return Mentor.transaction(function (t) {
				return UserRole
					.addRole(user, utils.roles.MENTOR, false, t)
					.then(function (result) {
						return _saveMentorAndIdeas(mentor, mentorIdeas);
					});
				});
			});
};

/**
* Finds a mentor by querying on a user's ID
* @param  {User} user		the user expected to be associated with a mentor
* @return {Promise<Mentor>}	resolving to the associated Mentor model
* @throws {NotFoundError} when the requested mentor cannot be found
*/
var findMentorByUser = function (user) {
	return Mentor
		.findByUserId(user.get('id'))
		.tap(function (result) {
			if (_.isNull(result)) {
				var message = "A mentor with the given user ID cannot be found";
				var source = "userId";
				throw new errors.NotFoundError(message, source);
			}
		});
};

/**
* Finds a mentor by querying for the given ID
* @param  {Number} id the ID to query
* @return {Promise<Mentor>} resolving to the associated Mentor model
* @throws {NotFoundError} when the requested mentor cannot be found
*/
var findMentorById = function (id) {
	return Mentor
		.findById(id)
		.tap(function (result) {
			if (_.isNull(result)) {
				var message = "A mentor with the given ID cannot be found";
				var source = "id";
				throw new errors.NotFoundError(message, source);
			}
		});
};

/**
* Updates a mentor and their project ideas by relational user
* @param  {Mentor} mentor the mentor to be updated
* @param  {Object} attributes a JSON object holding the mentor registration attributes
* @return {Promise} resolving to an object in the same format as attributes, holding the saved models
* @throws {InvalidParameterError} when a mentor doesn't exist for the specified user
*/
var updateMentor = function (mentor, attributes) {
	var mentorAttributes = attributes.mentor;
	var mentorIdeas = attributes.ideas;

	mentor.set(mentorAttributes);

	return mentor
		.validate()
		.catch(CheckitError, utils.errors.handleValidationError)
		.then(function (){
			return _extractMentorIdeas(mentor, mentorIdeas);
		})
		.spread(function (newIdeas, updatedIdeas, updatedIdeaIds){
			return Mentor.transaction(function (t) {
				return _adjustMentorIdeas(mentor, updatedIdeas, updatedIdeaIds, t)
					.then(function () {
						return _saveMentorAndIdeas(mentor, newIdeas, t);
					});
				});
			});
};

module.exports = {
	createMentor: createMentor,
	findMentorByUser: findMentorByUser,
	findMentorById: findMentorById,
	updateMentor: updateMentor
};