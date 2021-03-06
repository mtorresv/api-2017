var Request = require('./Request');
var validators = require('../utils/validators');
var registration = require('../utils/registration');

var extraInfoValidations = {
	info:       ['string', 'maxLength:255']
};

// NOTE: these are currently not supported
var projectValidations = {
	name:       ['required', 'string', 'maxLength:100'],
	description:['required', 'string', 'maxLength:255'],
	repo:       ['required', 'string', 'maxLength:150'],
	isSuggestion: ['required', 'boolean']
};

var ecosystemInterestValidations = {
	ecosystemId:  ['required', 'integer']
};

var requestedCollaboratorValidations = {
	collaborator: ['required', 'string', 'maxLength:255']
};

var bodyRequired = ['attendee'];
var bodyAllowed = ['ecosystemInterests', 'projects', 'extras', 'collaborators'];
var bodyValidations = {
	'attendee': ['required', 'plainObject'],
	'attendee.firstName': ['required', 'string', 'maxLength:255'],
	'attendee.lastName': ['required', 'string', 'maxLength:255'],
	'attendee.shirtSize': ['required', 'string', registration.verifyTshirtSize],
	'attendee.diet': ['required', 'string', registration.verifyDiet],
	'attendee.age': ['required', 'integer', 'min:13', 'max:115'],
	'attendee.graduationYear': ['required', 'integer', 'min:2017', 'max:2024'],
	'attendee.transportation': ['required', 'string', registration.verifyTransportation],
	'attendee.school': ['required', 'string', 'maxLength:255'],
	'attendee.major': ['required', 'string', 'maxLength:255'],
	'attendee.gender': ['required', 'string', registration.verifyGender],
	'attendee.professionalInterest': ['required', 'string', registration.verifyProfessionalInterest],
	'attendee.github': ['required', 'string', 'maxLength:50'],
	'attendee.linkedin':  ['required', 'string', 'maxLength:50'],
	'attendee.interests': ['required', 'string', 'maxLength:255'],
	'attendee.isNovice': ['required', 'boolean'],
	'attendee.isPrivate': ['required', 'boolean'],
	'attendee.hasLightningInterest': ['boolean'],
	'attendee.phoneNumber': ['string', 'maxLength:15'],
	'ecosystemInterests': ['array', 'maxLength:4', validators.array(validators.nested(ecosystemInterestValidations, 'ecosystemInterests'), 'ecosystemInterests')],
	'projects': ['array', 'maxLength:1', registration.verifyProjectArray, validators.array(validators.nested(projectValidations, 'projects'), 'projects')],
	'extras': ['array', 'maxLength:1', validators.array(validators.nested(extraInfoValidations, 'extras'), 'extras')],
	'collaborators': ['array', 'maxLength:8', validators.array(validators.nested(requestedCollaboratorValidations, 'collaborators'), 'collaborators')]
};

function AttendeeRequest(headers, body) {
	Request.call(this, headers, body);

	this.bodyRequired = bodyRequired;
	this.bodyAllowed = bodyAllowed;
	this.bodyValidations = bodyValidations;
}

AttendeeRequest._extraInfoValidations = extraInfoValidations;
AttendeeRequest._projectValidations = projectValidations;
AttendeeRequest._ecosystemInterestValidations = ecosystemInterestValidations;
AttendeeRequest._requestedCollaboratorValidations = requestedCollaboratorValidations;

AttendeeRequest.prototype = Object.create(Request.prototype);
AttendeeRequest.prototype.constructor = AttendeeRequest;

module.exports = AttendeeRequest;
